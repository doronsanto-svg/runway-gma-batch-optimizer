import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('reconcileActiveBatches shrinks active batch to latest label-needed orders', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fillement-batch-store-'));
  const originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;

  try {
    const store = await import(`../src/batch-store.js?case=${Date.now()}`);
    store.createBatchRecord({
      status: 'paused',
      sub_batch_id: 'SIG::USPS',
      order_count: 100,
      total_revenue: 1000,
      estimated_minutes: 40,
      order_ids: [1, 2, 3, 4],
      order_numbers: ['#1', '#2', '#3', '#4']
    });

    const reconciled = store.reconcileActiveBatches({
      actionable_batches: [{
        sub_batch_id: 'SIG::USPS',
        order_count: 2,
        total_revenue: 200,
        estimated_minutes: 8,
        order_ids: [3, 4],
        order_numbers: ['#3', '#4']
      }]
    });

    assert.equal(reconciled.active[0].order_count, 2);
    assert.deepEqual(reconciled.active[0].order_ids, [3, 4]);
    assert.equal(reconciled.active[0].original_order_count, 100);
    assert.deepEqual(reconciled.active[0].original_order_ids, [1, 2, 3, 4]);
    assert.ok(reconciled.active[0].reconciled_at);
  } finally {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    rmSync(dir, { recursive: true, force: true });
  }
});
