import test from 'node:test';
import assert from 'node:assert/strict';
import { VeeqoClient } from '../src/veeqo.js';

test('listAllOrders reports actual pages pulled when maxPages limits history', async () => {
  const client = new VeeqoClient({ apiKey: 'test', baseUrl: 'https://example.test' });
  client.listOrdersPage = async ({ page }) => ({
    orders: [{ id: String(page) }],
    totalCount: 300,
    totalPages: 3
  });

  const result = await client.listAllOrders({ status: '', pageSize: 100, maxPages: 2 });

  assert.equal(result.orders.length, 2);
  assert.equal(result.totalPages, 3);
  assert.equal(result.pagesPulled, 2);
});

test('listAllOrders stops at reported total pages', async () => {
  const pages = [];
  const client = new VeeqoClient({ apiKey: 'test', baseUrl: 'https://example.test' });
  client.listOrdersPage = async ({ page }) => {
    pages.push(page);
    return {
      orders: [{ id: String(page) }],
      totalCount: 200,
      totalPages: 2
    };
  };

  const result = await client.listAllOrders({ status: '', pageSize: 100, maxPages: 10 });

  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.pagesPulled, 2);
});
