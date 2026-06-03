import test from 'node:test';
import assert from 'node:assert/strict';
import { selectShipperForItems } from '../src/packaging-calculator.js';

const settings = {
  products: {
    'PL-RW-AA90-R': { name: 'All Access', length: 4, width: 3, height: 1, weight_oz: 2 },
    'PL-RW-BTS100-R': { name: 'Behind the Scenes', length: 5, width: 2, height: 2, weight_oz: 4 },
    'PL-RW-FL30-R': { name: 'First Look', length: 4, width: 2, height: 1, weight_oz: 2 },
    'PL-RW-SL30-R': { name: 'Spotlight', length: 4, width: 2, height: 1, weight_oz: 2 },
    'PL-RW-SB15-R': { name: 'Stage Bright', length: 4, width: 3, height: 1, weight_oz: 2 },
    'PL-RW-FT72-R': { name: 'Finishing Touch', length: 8, width: 5, height: 1, weight_oz: 3 }
  },
  shippers: {
    '6x10 pouch': { name: '6x10 pouch', length: 8, width: 6, height: 2, weight_oz: 0.5, kind: 'pouch', max_items: 1 },
    '8x12 pouch': { name: '8x12 pouch', length: 10, width: 8, height: 2, weight_oz: 0.5, kind: 'pouch', max_items: 3 },
    '8x6x4 box': { name: '8x6x4 box', length: 8, width: 6, height: 4, weight_oz: 1, kind: 'box' },
    '10x6x6 box': { name: '10x6x6 box', length: 10, width: 6, height: 6, weight_oz: 1, kind: 'box' },
    '12x6x6 box': { name: '12x6x6 box', length: 12, width: 6, height: 6, weight_oz: 1, kind: 'box' },
    '13x11x5 box': { name: '13x11x5 box', length: 13, width: 11, height: 5, weight_oz: 2, kind: 'box' }
  }
};

test('selectShipperForItems chooses the verified cheapest single-product shipper', () => {
  const result = selectShipperForItems([
    { sku: 'PL-RW-AA90-R', name: 'All Access', quantity: 1 }
  ], settings);

  assert.equal(result.ok, true);
  assert.equal(result.package, '6x10 pouch');
  assert.ok(result.placements.length === 1);
});

test('selectShipperForItems moves two products out of the 6x10 pouch', () => {
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
  assert.equal(result.placements.length, 2);
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

test('selectShipperForItems allows three physical units in the larger pouch when they fit', () => {
  const result = selectShipperForItems([
    { sku: 'PL-RW-AA90-R', name: 'All Access', quantity: 1 },
    { sku: 'PL-RW-SB15-R', name: 'Stage Bright', quantity: 1 },
    { sku: 'PL-RW-FL30-R', name: 'First Look', quantity: 1 }
  ], settings);

  assert.equal(result.ok, true);
  assert.equal(result.package, '8x12 pouch');
  assert.equal(result.placements.length, 3);
});

test('selectShipperForItems moves three physical units to a box when the larger pouch does not fit', () => {
  const result = selectShipperForItems([
    { sku: 'PL-RW-FT72-R', name: 'Finishing Touch', quantity: 3 }
  ], settings);

  assert.equal(result.ok, true);
  assert.equal(result.package, '8x6x4 box');
});

test('selectShipperForItems chooses pouch or box for multipacks by verified geometry', () => {
  const examples = [
    ['8x6x4 box', [
      { sku: 'PL-RW-AA90-R', name: 'All Access', quantity: 1 },
      { sku: 'PL-RW-SB15-R', name: 'Stage Bright', quantity: 3 }
    ]],
    ['8x12 pouch', [
      { sku: 'PL-RW-AA90-R', name: 'All Access', quantity: 2 },
      { sku: 'PL-RW-BTS100-R', name: 'Behind the Scenes', quantity: 1 }
    ]],
    ['8x12 pouch', [
      { sku: 'PL-RW-AA90-R', name: 'All Access', quantity: 2 },
      { sku: 'PL-RW-FL30-R', name: 'First Look', quantity: 1 }
    ]]
  ];

  for (const [expectedPackage, items] of examples) {
    const result = selectShipperForItems(items, settings);
    assert.equal(result.ok, true);
    assert.equal(result.package, expectedPackage);
  }
});

test('selectShipperForItems packs larger combinations by verified geometry', () => {
  const item = { sku: 'PL-RW-SB15-R', name: 'Stage Bright' };
  const examples = [
    [9, '8x6x4 box'],
    [12, '8x6x4 box'],
    [13, '8x6x4 box'],
    [15, '10x6x6 box'],
    [16, '10x6x6 box']
  ];

  for (const [quantity, expectedPackage] of examples) {
    const result = selectShipperForItems([{ ...item, quantity }], settings);
    assert.equal(result.ok, true);
    assert.equal(result.package, expectedPackage);
  }
});
