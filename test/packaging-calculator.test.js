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
    '6x10 pouch': { name: '6x10 pouch', length: 10, width: 6, height: 1, weight_oz: 0.2 },
    '6x10x2': { name: '6x10x2', length: 10, width: 6, height: 2, weight_oz: 0.2 },
    '8x10x2': { name: '8x10x2', length: 10, width: 8, height: 2, weight_oz: 0.3 },
    '8x12 pouch': { name: '8x12 pouch', length: 12, width: 8, height: 1.5, weight_oz: 0.3 },
    '8x6x4 box': { name: '8x6x4 box', length: 8, width: 6, height: 4, weight_oz: 1 },
    '10x6x6 box': { name: '10x6x6 box', length: 10, width: 6, height: 6, weight_oz: 1 },
    '12x6x6 box': { name: '12x6x6 box', length: 12, width: 6, height: 6, weight_oz: 1 },
    '13x11x5 box': { name: '13x11x5 box', length: 13, width: 11, height: 5, weight_oz: 1 }
  }
};

test('selectShipperForItems follows the single-product packing guide', () => {
  const result = selectShipperForItems([
    { sku: 'PL-RW-AA90-R', name: 'All Access', quantity: 1 }
  ], settings);

  assert.equal(result.ok, true);
  assert.equal(result.package, '6x10x2');
});

test('selectShipperForItems follows the kit packing guide', () => {
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
  assert.equal(result.package, '8x10x2');
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
  assert.equal(result.package, '6x10x2');
});

test('selectShipperForItems moves three or more physical units to a box', () => {
  const result = selectShipperForItems([
    { sku: 'PL-RW-AA90-R', name: 'All Access', quantity: 1 },
    { sku: 'PL-RW-SB15-R', name: 'Stage Bright', quantity: 1 },
    { sku: 'PL-RW-FT72-R', name: 'Finishing Touch', quantity: 1 }
  ], settings);

  assert.equal(result.ok, true);
  assert.equal(result.package, '8x6x4 box');
});

test('selectShipperForItems sends known multipack examples to 8x6x4 box', () => {
  const examples = [
    [
      { sku: 'PL-RW-AA90-R', name: 'All Access', quantity: 1 },
      { sku: 'PL-RW-SB15-R', name: 'Stage Bright', quantity: 3 }
    ],
    [
      { sku: 'PL-RW-FT72-R', name: 'Finishing Touch', quantity: 1 },
      { sku: 'PL-RW-SL30-R', name: 'Spotlight', quantity: 2 }
    ],
    [
      { sku: 'PL-RW-AA90-R', name: 'All Access', quantity: 2 },
      { sku: 'PL-RW-BTS100-R', name: 'Behind the Scenes', quantity: 1 }
    ],
    [
      { sku: 'PL-RW-AA90-R', name: 'All Access', quantity: 2 },
      { sku: 'PL-RW-FL30-R', name: 'First Look', quantity: 1 }
    ]
  ];

  for (const items of examples) {
    const result = selectShipperForItems(items, settings);
    assert.equal(result.ok, true);
    assert.equal(result.package, '8x6x4 box');
  }
});

test('selectShipperForItems scales larger combinations by physical unit count', () => {
  const item = { sku: 'PL-RW-SB15-R', name: 'Stage Bright' };
  const examples = [
    [9, '10x6x6 box'],
    [12, '10x6x6 box'],
    [13, '12x6x6 box'],
    [15, '12x6x6 box'],
    [16, '13x11x5 box']
  ];

  for (const [quantity, expectedPackage] of examples) {
    const result = selectShipperForItems([{ ...item, quantity }], settings);
    assert.equal(result.ok, true);
    assert.equal(result.package, expectedPackage);
  }
});
