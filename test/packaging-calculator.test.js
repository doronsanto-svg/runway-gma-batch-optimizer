import test from 'node:test';
import assert from 'node:assert/strict';
import { selectShipperForItems } from '../src/packaging-calculator.js';

const settings = {
  products: {
    'PL-RW-AA90-R': { name: 'All Access', length: 4, width: 3, height: 1, weight_oz: 2 },
    'PL-RW-SB15-R': { name: 'Stage Bright', length: 4, width: 3, height: 1, weight_oz: 2 },
    'PL-RW-FT72-R': { name: 'Finishing Touch', length: 8, width: 5, height: 1, weight_oz: 3 }
  },
  shippers: {
    '6x10 pouch': { name: '6x10 pouch', length: 10, width: 6, height: 1, weight_oz: 0.2 },
    '8x12 pouch': { name: '8x12 pouch', length: 12, width: 8, height: 2, weight_oz: 0.3 },
    '8x6x4 box': { name: '8x6x4 box', length: 8, width: 6, height: 4, weight_oz: 1 }
  }
};

test('selectShipperForItems chooses smallest fitting shipper', () => {
  const result = selectShipperForItems([
    { sku: 'PL-RW-AA90-R', name: 'All Access', quantity: 1 }
  ], settings);

  assert.equal(result.ok, true);
  assert.equal(result.package, '6x10 pouch');
});

test('selectShipperForItems expands kit components before selecting shipper', () => {
  const result = selectShipperForItems([
    {
      sku: 'PL-RW-TOR2-R',
      name: 'Overnight Recovery kit',
      quantity: 1,
      components: [
        { name: 'All Access', quantity: 1 },
        { name: 'Stage Bright', quantity: 1 }
      ]
    }
  ], settings);

  assert.equal(result.ok, true);
  assert.equal(result.package, '8x12 pouch');
});

test('selectShipperForItems returns review when dimensions are missing', () => {
  const result = selectShipperForItems([
    { sku: 'UNKNOWN', name: 'Unknown', quantity: 1 }
  ], settings);

  assert.equal(result.ok, false);
  assert.match(result.reason, /Missing dimensions/);
});

test('selectShipperForItems rotates packed dimensions across all axes', () => {
  const result = selectShipperForItems([
    { sku: 'PL-RW-FT72-R', name: 'Finishing Touch', quantity: 1 }
  ], settings);

  assert.equal(result.ok, true);
  assert.equal(result.package, '6x10 pouch');
});
