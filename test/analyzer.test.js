import test from 'node:test';
import assert from 'node:assert/strict';
import { splitHeldOrders } from '../src/analyzer.js';
import { getShopifyIssueScan } from '../src/shopify.js';

test('splitHeldOrders excludes hold issue orders from batchable orders', () => {
  const orders = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const { heldOrderIds, batchableOrders } = splitHeldOrders(orders, [
    { order_id: 1, hold: true },
    { order_id: 2, hold: false }
  ]);

  assert.deepEqual([...heldOrderIds], [1]);
  assert.deepEqual(batchableOrders.map((order) => order.id), [2, 3]);
});

test('getShopifyIssueScan reports disabled lookup when Shopify credentials are missing', async () => {
  const originalDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const originalToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

  try {
    const { issueMap, summary } = await getShopifyIssueScan([{ id: 1, number: '#1' }]);

    assert.equal(issueMap.size, 0);
    assert.equal(summary.enabled, false);
    assert.equal(summary.skipped_reason, 'Shopify API credentials are not configured.');
  } finally {
    if (originalDomain !== undefined) process.env.SHOPIFY_STORE_DOMAIN = originalDomain;
    if (originalToken !== undefined) process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = originalToken;
  }
});
