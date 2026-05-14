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
