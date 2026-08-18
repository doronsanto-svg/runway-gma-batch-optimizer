import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CBS_EVENT_ID, GMA_EVENT_ID, inferRecordEventId } from './event.js';

const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(process.cwd(), 'data');
const storePath = resolve(dataDir, 'batches.json');

function emptyStore() {
  return { active: [], completed: [], canceled: [] };
}

export function readBatchStore() {
  if (!existsSync(storePath)) return emptyStore();
  const store = { ...emptyStore(), ...JSON.parse(readFileSync(storePath, 'utf8')) };
  for (const bucket of ['active', 'completed', 'canceled']) {
    store[bucket] = (store[bucket] || []).map((record) => ({
      ...record,
      event_id: inferRecordEventId(record)
    }));
  }
  return store;
}

export function writeBatchStore(store) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2));
}

export function listBatches(eventId = null) {
  const store = readBatchStore();
  if (!eventId) return store;
  return Object.fromEntries(Object.entries(store).map(([bucket, rows]) => [
    bucket,
    (rows || []).filter((record) => inferRecordEventId(record) === eventId)
  ]));
}

export function reconcileActiveBatches(report) {
  const store = readBatchStore();
  const eventId = report?.event_id || null;
  const actionable = report?.actionable_batches || report?.clusters || [];
  const bySubBatchId = new Map(actionable.map((batch) => [batch.sub_batch_id || batch.signature, batch]));
  let changed = false;

  store.active = store.active.map((batch) => {
    if (eventId && inferRecordEventId(batch) !== eventId) return batch;
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
  const eventId = record.event_id || GMA_EVENT_ID;
  const existing = store.active.find((batch) => batch.sub_batch_id === record.sub_batch_id && inferRecordEventId(batch) === eventId);
  if (existing) return existing;

  const batch = {
    id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    event_id: eventId,
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

export function reopenCompletedBatchRecord(identifier, updates = {}) {
  const store = readBatchStore();
  const index = store.completed.findIndex((batch) => (
    batch.id === identifier ||
    batch.tag_name === identifier ||
    String(batch.tag_id || '') === String(identifier || '')
  ));
  if (index === -1) return null;

  const [completed] = store.completed.splice(index, 1);
  const {
    completed_at: completedAt,
    duration_seconds: durationSeconds,
    orders_per_minute: ordersPerMinute,
    ...rest
  } = completed;

  const reopened = {
    ...rest,
    ...updates,
    status: updates.status || (inferRecordEventId(completed) === CBS_EVENT_ID ? 'parked' : 'paused'),
    reopened_at: updates.reopened_at || new Date().toISOString(),
    reopened_from_completed_at: completedAt || null,
    reopened_duration_seconds: durationSeconds || null,
    reopened_orders_per_minute: ordersPerMinute || null
  };

  store.active.unshift(reopened);
  writeBatchStore(store);
  return reopened;
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

export function updateStoredBatchRecord(batchId, updates) {
  const store = readBatchStore();
  for (const bucket of ['active', 'completed', 'canceled']) {
    const index = store[bucket].findIndex((batch) => batch.id === batchId);
    if (index === -1) continue;

    store[bucket][index] = {
      ...store[bucket][index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    writeBatchStore(store);
    return store[bucket][index];
  }
  return null;
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
