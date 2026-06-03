import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrderLineItems } from '../src/clusterer.js';
import { buildPrepRows, packageSuggestionForRow, prepKey, prepSummary, sortPrepRowsBySharedItems, stagingTotalsForPrepRows } from '../src/prep-store.js';

const clusters = [
  {
    signature: 'SKU-A:1|SKU-B:1',
    label: 'Combo A + B',
    category: 'combo',
    package: '8x12 pouch if it fits',
    station: 'A or B',
    order_count: 12,
    estimated_minutes: 15,
    order_ids: [1, 2, 3],
    order_numbers: ['#1', '#2', '#3'],
    items: []
  },
  {
    signature: 'SKU-C:1',
    label: 'Single C',
    category: 'single_qty1',
    package: '6x10 pouch',
    station: 'A',
    order_count: 4,
    estimated_minutes: 2,
    order_ids: [4],
    order_numbers: ['#4'],
    items: []
  }
];

test('buildPrepRows applies package overrides by signature', () => {
  const rows = buildPrepRows(clusters, {
    package_overrides: {
      'SKU-A:1|SKU-B:1': { package: '8x6x4 box' }
    },
    prepared: {}
  });

  const combo = rows.find((row) => row.signature === 'SKU-A:1|SKU-B:1');
  assert.equal(combo.package, '8x6x4 box');
  assert.equal(combo.default_package, '8x12 pouch if it fits');
  assert.equal(combo.package_overridden, true);
});

test('packageSuggestionForRow learns from similar category and item count', () => {
  const suggestion = packageSuggestionForRow({
    signature: 'SKU-D:1|KIT-E:1',
    category: 'combo',
    package: '8x12 pouch if it fits',
    items: [
      { sku: 'SKU-D', quantity: 1, pieces: 1 },
      { sku: 'KIT-E', quantity: 1, pieces: 2 }
    ]
  }, {
    package_overrides: {},
    package_memory: {
      signatures: {},
      groups: {
        'combo::3': { selected_package: '8x6x4 box' }
      },
      categories: {}
    },
    prepared: {}
  });

  assert.equal(suggestion.packageName, '8x6x4 box');
  assert.equal(suggestion.source, 'similar_memory');
});

test('packageSuggestionForRow uses calculated package before learned memory', () => {
  const suggestion = packageSuggestionForRow({
    signature: 'PL-RW-AA90-R:1|PL-RW-SB15-R:1',
    category: 'combo',
    package: '8x12 pouch if it fits',
    items: [
      { sku: 'PL-RW-AA90-R', name: 'All Access', quantity: 1 },
      { sku: 'PL-RW-SB15-R', name: 'Stage Bright', quantity: 1 }
    ]
  }, {
    package_overrides: {},
    package_memory: {
      signatures: {},
      groups: {
        'combo::2': { selected_package: '8x6x4 box' }
      },
      categories: {}
    },
    prepared: {}
  });

  assert.equal(suggestion.packageName, '8x10x2');
  assert.equal(suggestion.source, 'calculated');
});

test('packageSuggestionForRow keeps explicit saved choice over calculated package', () => {
  const suggestion = packageSuggestionForRow({
    signature: 'PL-RW-AA90-R:1|PL-RW-SB15-R:1',
    category: 'combo',
    package: '8x12 pouch if it fits',
    items: [
      { sku: 'PL-RW-AA90-R', name: 'All Access', quantity: 1 },
      { sku: 'PL-RW-SB15-R', name: 'Stage Bright', quantity: 1 }
    ]
  }, {
    package_overrides: {
      'PL-RW-AA90-R:1|PL-RW-SB15-R:1': { package: '8x12 pouch' }
    },
    package_memory: { signatures: {}, groups: {}, categories: {} },
    prepared: {}
  });

  assert.equal(suggestion.packageName, '8x12 pouch');
  assert.equal(suggestion.source, 'exact');
});

test('buildPrepRows marks prepared rows by signature and package', () => {
  const key = prepKey('SKU-C:1', '6x10 pouch');
  const rows = buildPrepRows(clusters, {
    package_overrides: {},
    prepared: {
      [key]: { prepared: true, prepared_at: '2026-06-01T00:00:00.000Z' }
    }
  });

  const single = rows.find((row) => row.signature === 'SKU-C:1');
  assert.equal(single.prepared, true);
  assert.equal(single.prepared_at, '2026-06-01T00:00:00.000Z');
});

test('prepSummary counts open and prepared work', () => {
  const rows = buildPrepRows(clusters, {
    package_overrides: {},
    prepared: {
      [prepKey('SKU-C:1', '6x10 pouch')]: { prepared: true }
    }
  });

  assert.deepEqual(prepSummary(rows), {
    rows: 2,
    open_rows: 1,
    prepared_rows: 1,
    open_orders: 12,
    prepared_orders: 4,
    estimated_minutes: 15
  });
});

test('sortPrepRowsBySharedItems keeps overlapping item rows close together', () => {
  const rows = sortPrepRowsBySharedItems([
    {
      label: 'Radiance Ready + Behind the Scenes + First Look',
      order_count: 4,
      items: [{ sku: 'RR' }, { sku: 'BTS' }, { sku: 'FL' }]
    },
    {
      label: 'Stage Bright',
      order_count: 12,
      items: [{ sku: 'SB' }]
    },
    {
      label: 'Finishing Touch + Behind the Scenes + First Look',
      order_count: 5,
      items: [{ sku: 'FT' }, { sku: 'BTS' }, { sku: 'FL' }]
    }
  ]);

  assert.equal(rows[1].label, 'Finishing Touch + Behind the Scenes + First Look');
  assert.equal(rows[2].label, 'Radiance Ready + Behind the Scenes + First Look');
});

test('stagingTotalsForPrepRows multiplies quantities, pieces, and order count', () => {
  const totals = stagingTotalsForPrepRows([
    {
      order_count: 9,
      items: [
        { name: 'Behind the Scenes', quantity: 1, pieces: 1 },
        { name: 'Overnight Recovery kit', quantity: 1, pieces: 2 }
      ]
    },
    {
      order_count: 3,
      items: [{ name: 'Behind the Scenes', quantity: 2, pieces: 1 }]
    }
  ]);

  assert.deepEqual(totals, [
    { label: 'Overnight Recovery kit', quantity: 18 },
    { label: 'Behind the Scenes', quantity: 15 }
  ]);
});

test('kit line items carry recipe components for prep staging', () => {
  const [kit] = normalizeOrderLineItems({
    line_items: [
      {
        quantity: 1,
        sellable: {
          sku_code: 'PL-RW-TOR2-R',
          full_title: 'The Overnight Recovery'
        }
      }
    ]
  });

  assert.equal(kit.name, 'Overnight Recovery kit');
  assert.equal(kit.pieces, 2);
  assert.deepEqual(kit.components, [
    { name: 'All Access', quantity: 1 },
    { name: 'Stage Bright', quantity: 1 }
  ]);
});
