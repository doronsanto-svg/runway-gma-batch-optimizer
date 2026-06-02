import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectShipperForItems } from './packaging-calculator.js';
import { readPackagingSettings } from './packaging-store.js';

const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(process.cwd(), 'data');
const storePath = resolve(dataDir, 'prep-state.json');

export const PACKAGE_OPTIONS = ['6x10 pouch', '8x12 pouch', '8x6x4 box'];

function emptyStore() {
  return { package_overrides: {}, package_memory: { signatures: {}, groups: {}, categories: {} }, prepared: {} };
}

export function prepKey(signature, packageName) {
  return `${signature}::${packageName || ''}`;
}

export function readPrepStore() {
  if (!existsSync(storePath)) return emptyStore();
  const store = { ...emptyStore(), ...JSON.parse(readFileSync(storePath, 'utf8')) };
  store.package_memory = { ...emptyStore().package_memory, ...(store.package_memory || {}) };
  return store;
}

export function writePrepStore(store) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2));
}

function itemUnits(items = []) {
  return (items || []).reduce((sum, item) => sum + (Number(item.quantity || 1) * Number(item.pieces || 1)), 0);
}

function itemKey(item) {
  return item?.sku || item?.name || item?.title || '';
}

function itemLabel(item) {
  return item?.name || item?.title || item?.sku || 'Item';
}

function groupKey({ category, items = [] }) {
  return `${category || 'unknown'}::${itemUnits(items) || 0}`;
}

function recordPackageMemory(store, { signature, label, packageName, category, items }) {
  const cleanPackage = String(packageName || '').trim();
  if (!cleanPackage) return;
  const now = new Date().toISOString();
  const units = itemUnits(items);
  const group = groupKey({ category, items });
  const memoryTargets = [
    ['signatures', signature],
    ['groups', group],
    ['categories', category || 'unknown']
  ];

  for (const [bucket, key] of memoryTargets) {
    if (!key) continue;
    const existing = store.package_memory[bucket][key] || {
      key,
      label,
      category: category || 'unknown',
      item_units: units,
      package_counts: {},
      selected_package: cleanPackage,
      updated_at: now
    };
    existing.package_counts[cleanPackage] = (existing.package_counts[cleanPackage] || 0) + 1;
    existing.selected_package = Object.entries(existing.package_counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    existing.updated_at = now;
    store.package_memory[bucket][key] = existing;
  }
}

function packageSuggestionForCluster(cluster, store) {
  const exact = store.package_overrides?.[cluster.signature]?.package;
  if (exact) return { packageName: exact, source: 'exact' };

  const calculated = selectShipperForItems(cluster.items || [], readPackagingSettings());
  if (calculated.ok) return { packageName: calculated.package, source: 'calculated' };

  const signatureMemory = store.package_memory?.signatures?.[cluster.signature]?.selected_package;
  if (signatureMemory) return { packageName: signatureMemory, source: 'signature_memory' };

  const groupMemory = store.package_memory?.groups?.[groupKey(cluster)]?.selected_package;
  if (groupMemory) return { packageName: groupMemory, source: 'similar_memory' };

  const categoryMemory = store.package_memory?.categories?.[cluster.category || 'unknown']?.selected_package;
  if (categoryMemory) return { packageName: categoryMemory, source: 'category_memory' };

  return { packageName: cluster.package, source: 'default' };
}

export function packageSuggestionForRow(row, store = readPrepStore()) {
  return packageSuggestionForCluster(row, store);
}

export function packageOptions() {
  const settings = readPackagingSettings();
  return Object.keys(settings.shippers || {}).length ? Object.keys(settings.shippers) : PACKAGE_OPTIONS;
}

export function prepItemLabels(row) {
  return (row?.items || [])
    .slice()
    .sort((a, b) => itemLabel(a).localeCompare(itemLabel(b)))
    .map(itemLabel);
}

export function prepOverlapScore(rowA, rowB) {
  const keysA = new Set((rowA?.items || []).map(itemKey).filter(Boolean));
  const keysB = new Set((rowB?.items || []).map(itemKey).filter(Boolean));
  return [...keysA].filter((key) => keysB.has(key)).length;
}

export function sortPrepRowsBySharedItems(rows = []) {
  const openRows = rows.filter((row) => !row.prepared);
  const preparedRows = rows.filter((row) => row.prepared);
  const sorted = [];
  const remaining = [...openRows].sort((a, b) => b.order_count - a.order_count || a.label.localeCompare(b.label));

  while (remaining.length) {
    const current = sorted.length
      ? remaining
        .map((row, index) => ({ row, index, score: prepOverlapScore(sorted[sorted.length - 1], row) }))
        .sort((a, b) => b.score - a.score || b.row.order_count - a.row.order_count || a.row.label.localeCompare(b.row.label))[0]
      : { row: remaining[0], index: 0 };
    sorted.push(current.row);
    remaining.splice(current.index, 1);
  }

  return [...sorted, ...preparedRows.sort((a, b) => b.order_count - a.order_count || a.label.localeCompare(b.label))];
}

export function stagingTotalsForPrepRows(rows = []) {
  const totals = new Map();
  for (const row of rows) {
    const orderCount = Number(row.order_count || 0);
    for (const item of row.items || []) {
      const label = itemLabel(item);
      const quantity = Number(item.quantity || 1);
      const pieces = Number(item.pieces || 1);
      const total = orderCount * quantity * pieces;
      totals.set(label, (totals.get(label) || 0) + total);
    }
  }
  return [...totals.entries()]
    .map(([label, quantity]) => ({ label, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label));
}

export function setPackageOverride({ signature, label, packageName, category = '', items = [] }) {
  const store = readPrepStore();
  const cleanPackage = String(packageName || '').trim();
  if (!cleanPackage) {
    delete store.package_overrides[signature];
  } else {
    store.package_overrides[signature] = {
      signature,
      label,
      package: cleanPackage,
      category,
      item_units: itemUnits(items),
      updated_at: new Date().toISOString()
    };
    recordPackageMemory(store, { signature, label, packageName: cleanPackage, category, items });
  }
  writePrepStore(store);
  return store;
}

export function setPreparedStatus({ signature, label, packageName, prepared }) {
  const store = readPrepStore();
  const key = prepKey(signature, packageName);
  store.prepared[key] = {
    signature,
    label,
    package: packageName,
    prepared: Boolean(prepared),
    updated_at: new Date().toISOString(),
    prepared_at: prepared ? new Date().toISOString() : null
  };
  writePrepStore(store);
  return store;
}

export function buildPrepRows(clusters, store = readPrepStore()) {
  return (clusters || []).map((cluster) => {
    const suggestion = packageSuggestionForCluster(cluster, store);
    const packageName = suggestion.packageName;
    const key = prepKey(cluster.signature, packageName);
    const preparedRecord = store.prepared?.[key] || {};
    return {
      prep_key: key,
      signature: cluster.signature,
      label: cluster.label,
      category: cluster.category,
      package: packageName,
      default_package: cluster.package,
      package_overridden: suggestion.source === 'exact',
      package_suggestion_source: suggestion.source,
      package_options: packageOptions(),
      station: cluster.station,
      order_count: cluster.order_count,
      estimated_minutes: cluster.estimated_minutes,
      order_ids: cluster.order_ids,
      order_numbers: cluster.order_numbers,
      sample_order_numbers: (cluster.order_numbers || []).slice(0, 12),
      items: cluster.items,
      prepared: Boolean(preparedRecord.prepared),
      prepared_at: preparedRecord.prepared_at || null,
      prepared_updated_at: preparedRecord.updated_at || null
    };
  });
  return sortPrepRowsBySharedItems(rows);
}

export function prepSummary(rows) {
  const openRows = rows.filter((row) => !row.prepared);
  const preparedRows = rows.filter((row) => row.prepared);
  return {
    rows: rows.length,
    open_rows: openRows.length,
    prepared_rows: preparedRows.length,
    open_orders: openRows.reduce((sum, row) => sum + row.order_count, 0),
    prepared_orders: preparedRows.reduce((sum, row) => sum + row.order_count, 0),
    estimated_minutes: openRows.reduce((sum, row) => sum + row.estimated_minutes, 0)
  };
}
