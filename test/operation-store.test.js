import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('batch operations are idempotent and persist progress', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fillement-operation-store-'));
  const originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    const store = await import(`../src/operation-store.js?case=${Date.now()}`);
    const first = store.createOperation({
      idempotencyKey: 'same-cbs-work', eventId: 'cbs_deals', kind: 'sub_batch', input: { order_ids: [3, 1, 2] }
    });
    const repeated = store.createOperation({
      idempotencyKey: 'same-cbs-work', eventId: 'cbs_deals', kind: 'sub_batch', input: { order_ids: [1, 2, 3] }
    });
    assert.equal(repeated.id, first.id);
    store.updateOperation(first.id, { status: 'running', stage: 'updating_packages', completed_orders: 2 });
    assert.equal(store.getOperation(first.id).completed_orders, 2);
    assert.equal(store.findOperationByIdempotencyKey('same-cbs-work').stage, 'updating_packages');
  } finally {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    rmSync(dir, { recursive: true, force: true });
  }
});
