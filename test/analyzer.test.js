import test from 'node:test';
import assert from 'node:assert/strict';
import { orderHasPurchasedLabel, splitHeldOrders } from '../src/analyzer.js';

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
