import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GMA_SKUS } from './constants.js';

const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(process.cwd(), 'data');
const storePath = resolve(dataDir, 'packaging-settings.json');

function defaultProducts() {
  return Object.fromEntries(Object.entries(GMA_SKUS)
    .filter(([, config]) => config.type === 'single')
    .map(([sku, config]) => [sku, {
      sku,
      name: config.name,
      length: 0,
      width: 0,
      height: 0,
      weight_oz: 0
    }]));
}

function defaultShippers() {
  return {
    '6x10 pouch': { name: '6x10 pouch', length: 10, width: 6, height: 1, weight_oz: 0 },
    '8x12 pouch': { name: '8x12 pouch', length: 12, width: 8, height: 1.5, weight_oz: 0 },
    '8x6x4 box': { name: '8x6x4 box', length: 8, width: 6, height: 4, weight_oz: 0 }
  };
}

export function defaultPackagingSettings() {
  return {
    dimensions_unit: 'inches',
    weight_unit: 'oz',
    products: defaultProducts(),
    shippers: defaultShippers()
  };
}

export function readPackagingSettings() {
  const defaults = defaultPackagingSettings();
  if (!existsSync(storePath)) return defaults;
  const saved = JSON.parse(readFileSync(storePath, 'utf8'));
  return {
    ...defaults,
    ...saved,
    products: { ...defaults.products, ...(saved.products || {}) },
    shippers: { ...defaults.shippers, ...(saved.shippers || {}) }
  };
}

export function writePackagingSettings(settings) {
  const defaults = defaultPackagingSettings();
  const next = {
    ...defaults,
    ...settings,
    dimensions_unit: 'inches',
    weight_unit: 'oz',
    products: { ...defaults.products, ...(settings.products || {}) },
    shippers: { ...defaults.shippers, ...(settings.shippers || {}) }
  };
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(storePath, JSON.stringify(next, null, 2));
  return next;
}
