import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(process.cwd(), 'data');
const storePath = resolve(dataDir, 'batch-operations.json');

function emptyStore() {
  return { operations: [] };
}

export function readOperationStore() {
  if (!existsSync(storePath)) return emptyStore();
  return { ...emptyStore(), ...JSON.parse(readFileSync(storePath, 'utf8')) };
}

function writeOperationStore(store) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2));
  return store;
}

export function findOperationByIdempotencyKey(idempotencyKey) {
  return readOperationStore().operations.find((operation) => operation.idempotency_key === idempotencyKey) || null;
}

export function createOperation({ idempotencyKey, eventId, kind, input }) {
  const store = readOperationStore();
  const existing = store.operations.find((operation) => operation.idempotency_key === idempotencyKey);
  if (existing) return existing;
  const now = new Date().toISOString();
  const operation = {
    id: `operation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    idempotency_key: idempotencyKey,
    event_id: eventId,
    kind,
    input,
    status: 'queued',
    stage: 'queued',
    total_orders: 0,
    completed_orders: 0,
    failed_orders: 0,
    failures: [],
    batch_ids: [],
    created_at: now,
    updated_at: now
  };
  store.operations.unshift(operation);
  store.operations = store.operations.slice(0, 250);
  writeOperationStore(store);
  return operation;
}

export function getOperation(operationId) {
  return readOperationStore().operations.find((operation) => operation.id === operationId) || null;
}

export function updateOperation(operationId, updates = {}) {
  const store = readOperationStore();
  const index = store.operations.findIndex((operation) => operation.id === operationId);
  if (index === -1) return null;
  store.operations[index] = {
    ...store.operations[index],
    ...updates,
    updated_at: new Date().toISOString()
  };
  writeOperationStore(store);
  return store.operations[index];
}
