import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPackageStateToReport, completedOrderIdsForAnalysis, orderHasPurchasedLabel, splitHeldOrders } from '../src/analyzer.js';

test('splitHeldOrders excludes hold issue orders from batchable orders', () => {
  const orders = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const { heldOrderIds, batchableOrders } = splitHeldOrders(orders, [
    { order_id: 1, hold: true },
    { order_id: 2, hold: false }
  ]);

  assert.deepEqual([...heldOrderIds], [1]);
  assert.deepEqual(batchableOrders.map((order) => order.id), [2, 3]);
});

test('orderHasPurchasedLabel detects shipment or tracking fields', () => {
  assert.equal(orderHasPurchasedLabel({ allocations: [{ shipment: null }] }), false);
  assert.equal(orderHasPurchasedLabel({ allocations: [{ shipment: { id: 123 } }] }), true);
  assert.equal(orderHasPurchasedLabel({ tracking_number: '9400' }), true);
  assert.equal(orderHasPurchasedLabel({ shipped_at: '2026-06-01T00:00:00.000Z' }), true);
});

test('completedOrderIdsForAnalysis excludes completed live orders but ignores demo batches', () => {
  const orderIds = completedOrderIdsForAnalysis({
    active: [{ mode: 'live', order_ids: [99] }],
    completed: [
      { mode: 'live', order_ids: [1, 2] },
      { mode: 'demo', order_ids: [3] },
      { order_ids: [4] }
    ]
  });

  assert.deepEqual([...orderIds], [1, 2, 4]);
});

test('applyPackageStateToReport reapplies saved package choices to latest report', () => {
  const report = {
    summary: {},
    clusters: [{
      signature: 'SKU-A:1',
      label: 'Single A',
      category: 'single_qty1',
      package: '6x10 pouch',
      station: 'A',
      order_count: 1,
      estimated_minutes: 1,
      order_ids: [1],
      order_numbers: ['#1'],
      items: [{ sku: 'SKU-A', quantity: 1, pieces: 1 }],
      sub_batches: []
    }],
    actionable_batches: [{
      sub_batch_id: 'SKU-A:1::usps',
      signature: 'SKU-A:1',
      label: 'Single A · USPS',
      category: 'single_qty1',
      carrier: 'usps',
      carrier_label: 'USPS',
      package: '6x10 pouch',
      station: 'A',
      order_count: 1,
      estimated_minutes: 1,
      order_ids: [1],
      order_numbers: ['#1'],
      items: [{ sku: 'SKU-A', quantity: 1, pieces: 1 }]
    }]
  };

  const hydrated = applyPackageStateToReport(report, {
    package_overrides: {
      'SKU-A:1': { package: '8x12 pouch' }
    },
    package_memory: { signatures: {}, groups: {}, categories: {} },
    prepared: {}
  });

  assert.equal(hydrated.clusters[0].package, '8x12 pouch');
  assert.equal(hydrated.actionable_batches[0].package, '8x12 pouch');
  assert.equal(hydrated.prep_rows[0].package, '8x12 pouch');
});
