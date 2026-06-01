import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(process.cwd(), 'data');
const storePath = resolve(dataDir, 'batches.json');

function emptyStore() {
  return { active: [], completed: [], canceled: [] };
}

export function readBatchStore() {
  if (!existsSync(storePath)) return emptyStore();
  return { ...emptyStore(), ...JSON.parse(readFileSync(storePath, 'utf8')) };
}

export function writeBatchStore(store) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2));
}

export function listBatches() {
  return readBatchStore();
}

export function reconcileActiveBatches(report) {
  const store = readBatchStore();
  const actionable = report?.actionable_batches || report?.clusters || [];
  const bySubBatchId = new Map(actionable.map((batch) => [batch.sub_batch_id || batch.signature, batch]));
  let changed = false;

  store.active = store.active.map((batch) => {
    const latest = bySubBatchId.get(batch.sub_batch_id);
    if (!latest) return batch;

    const nextOrderIds = latest.order_ids || [];
    const currentOrderIds = batch.order_ids || [];
    const sameOrders = currentOrderIds.length === nextOrderIds.length && currentOrderIds.every((id, index) => id === nextOrderIds[index]);
    if (
      sameOrders &&
      batch.order_count === latest.order_count &&
      batch.total_revenue === latest.total_revenue &&
      batch.estimated_minutes === latest.estimated_minutes
    ) {
      return batch;
    }

    changed = true;
    return {
      ...batch,
      original_order_count: batch.original_order_count || batch.order_count,
      original_order_ids: batch.original_order_ids || batch.order_ids,
      order_count: latest.order_count,
      total_revenue: latest.total_revenue,
      estimated_minutes: latest.estimated_minutes,
      order_ids: nextOrderIds,
      order_numbers: latest.order_numbers || [],
      reconciled_at: new Date().toISOString()
    };
  });

  if (changed) writeBatchStore(store);
  return store;
}

export function createBatchRecord(record) {
  const store = readBatchStore();
  const existing = store.active.find((batch) => batch.sub_batch_id === record.sub_batch_id);
  if (existing) return existing;

  const batch = {
    id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    ...record
  };

  store.active.unshift(batch);
  writeBatchStore(store);
  return batch;
}

export function completeBatchRecord(batchId, updates) {
  const store = readBatchStore();
  const index = store.active.findIndex((batch) => batch.id === batchId);
  if (index === -1) return null;

  const [active] = store.active.splice(index, 1);
  const completed = {
    ...active,
    ...updates,
    completed_at: updates.completed_at || new Date().toISOString()
  };

  store.completed.unshift(completed);
  writeBatchStore(store);
  return completed;
}

export function updateActiveBatchRecord(batchId, updates) {
  const store = readBatchStore();
  const index = store.active.findIndex((batch) => batch.id === batchId);
  if (index === -1) return null;

  store.active[index] = {
    ...store.active[index],
    ...updates,
    updated_at: new Date().toISOString()
  };
  writeBatchStore(store);
  return store.active[index];
}

export function cancelBatchRecord(batchId, updates) {
  const store = readBatchStore();
  const index = store.active.findIndex((batch) => batch.id === batchId);
  if (index === -1) return null;

  const [active] = store.active.splice(index, 1);
  const canceled = {
    ...active,
    ...updates,
    status: 'canceled',
    canceled_at: updates.canceled_at || new Date().toISOString()
  };

  store.canceled.unshift(canceled);
  writeBatchStore(store);
  return canceled;
}
