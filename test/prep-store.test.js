import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrepRows, prepKey, prepSummary } from '../src/prep-store.js';

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
