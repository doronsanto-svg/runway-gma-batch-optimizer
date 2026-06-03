import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GMA_SKUS } from './constants.js';

const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(process.cwd(), 'data');
const storePath = resolve(dataDir, 'packaging-settings.json');
const deprecatedShipperNames = new Set(['6x10x2', '8x10x2']);

const productDimensions = {
  'PL-RW-FL30-R': { length: 1.6875, width: 1.6875, height: 4.1875, weight_oz: 4.45 },
  'PL-RW-BTS100-R': { length: 2.1875, width: 2.1875, height: 5.125, weight_oz: 11.53 },
  'PL-RW-SL30-R': { length: 2.125, width: 2.125, height: 4, weight_oz: 7.43 },
  'PL-RW-SB15-R': { length: 1.375, width: 1, height: 5.375, weight_oz: 1.39 },
  'PL-RW-RR50-R': { length: 2.375, width: 2.375, height: 3.1875, weight_oz: 8.23 },
  'PL-RW-AA90-R': { length: 2.1875, width: 1.75, height: 6.625, weight_oz: 4.92 },
  'PL-RW-FT72-R': { length: 2.1875, width: 1.75, height: 5.875, weight_oz: 3.85 }
};

function positiveNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function mergeDimensionRecord(defaultRecord = {}, savedRecord = {}) {
  return {
    ...defaultRecord,
    ...savedRecord,
    length: positiveNumber(savedRecord.length) ?? defaultRecord.length ?? 0,
    width: positiveNumber(savedRecord.width) ?? defaultRecord.width ?? 0,
    height: positiveNumber(savedRecord.height) ?? defaultRecord.height ?? 0,
    weight_oz: positiveNumber(savedRecord.weight_oz) ?? defaultRecord.weight_oz ?? 0
  };
}

function mergeDimensionMap(defaults = {}, saved = {}) {
  const keys = new Set([...Object.keys(defaults), ...Object.keys(saved)]);
  return Object.fromEntries([...keys].map((key) => [
    key,
    mergeDimensionRecord(defaults[key] || { name: key }, saved[key] || {})
  ]));
}

function mergeShipperMap(defaults = {}, saved = {}) {
  const keys = new Set([...Object.keys(defaults), ...Object.keys(saved)]);
  return Object.fromEntries([...keys].filter((key) => !deprecatedShipperNames.has(key)).map((key) => {
    if (defaults[key]) return [key, { ...(saved[key] || {}), ...defaults[key] }];
    return [key, mergeDimensionRecord({ name: key }, saved[key] || {})];
  }));
}

function defaultProducts() {
  return Object.fromEntries(Object.entries(GMA_SKUS)
    .filter(([, config]) => config.type === 'single')
    .map(([sku, config]) => [sku, {
      sku,
      name: config.name,
      ...(productDimensions[sku] || { length: 0, width: 0, height: 0, weight_oz: 0 })
    }]));
}

function defaultShippers() {
  return {
    '6x10 pouch': { name: '6x10 pouch', length: 8, width: 6, height: 2, weight_oz: 0.5, kind: 'pouch', max_items: 1 },
    '8x12 pouch': { name: '8x12 pouch', length: 10, width: 8, height: 2, weight_oz: 0.5, kind: 'pouch', max_items: 3 },
    '8x6x4 box': { name: '8x6x4 box', length: 8, width: 6, height: 4, weight_oz: 1, kind: 'box' },
    '10x6x6 box': { name: '10x6x6 box', length: 10, width: 6, height: 6, weight_oz: 1, kind: 'box' },
    '12x6x6 box': { name: '12x6x6 box', length: 12, width: 6, height: 6, weight_oz: 1, kind: 'box' },
    '13x11x5 box': { name: '13x11x5 box', length: 13, width: 11, height: 5, weight_oz: 2, kind: 'box' }
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
    products: mergeDimensionMap(defaults.products, saved.products || {}),
    shippers: mergeShipperMap(defaults.shippers, saved.shippers || {})
  };
}

export function writePackagingSettings(settings) {
  const defaults = defaultPackagingSettings();
  const next = {
    ...defaults,
    ...settings,
    dimensions_unit: 'inches',
    weight_unit: 'oz',
    products: mergeDimensionMap(defaults.products, settings.products || {}),
    shippers: mergeShipperMap(defaults.shippers, settings.shippers || {})
  };
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(storePath, JSON.stringify(next, null, 2));
  return next;
}
