import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(process.cwd(), 'data');
const cachePath = resolve(dataDir, 'carrier-cache.json');

export function readCarrierCache() {
  if (!existsSync(cachePath)) return {};
  return JSON.parse(readFileSync(cachePath, 'utf8'));
}

export function writeCarrierCache(cache) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}
