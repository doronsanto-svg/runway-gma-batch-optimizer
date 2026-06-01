import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(process.cwd(), 'data');
const storePath = resolve(dataDir, 'prep-state.json');

export const PACKAGE_OPTIONS = ['6x10 pouch', '8x12 pouch', '8x6x4 box'];

function emptyStore() {
  return { package_overrides: {}, prepared: {} };
}

export function prepKey(signature, packageName) {
  return `${signature}::${packageName || ''}`;
}

export function readPrepStore() {
  if (!existsSync(storePath)) return emptyStore();
  return { ...emptyStore(), ...JSON.parse(readFileSync(storePath, 'utf8')) };
}

export function writePrepStore(store) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2));
}

export function setPackageOverride({ signature, label, packageName }) {
  const store = readPrepStore();
  const cleanPackage = String(packageName || '').trim();
  if (!cleanPackage) {
    delete store.package_overrides[signature];
  } else {
    store.package_overrides[signature] = {
      signature,
      label,
      package: cleanPackage,
      updated_at: new Date().toISOString()
    };
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
    const override = store.package_overrides?.[cluster.signature];
    const packageName = override?.package || cluster.package;
    const key = prepKey(cluster.signature, packageName);
    const preparedRecord = store.prepared?.[key] || {};
    return {
      prep_key: key,
      signature: cluster.signature,
      label: cluster.label,
      category: cluster.category,
      package: packageName,
      default_package: cluster.package,
      package_overridden: Boolean(override?.package),
      package_options: PACKAGE_OPTIONS,
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
  }).sort((a, b) => Number(a.prepared) - Number(b.prepared) || b.order_count - a.order_count || a.label.localeCompare(b.label));
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
