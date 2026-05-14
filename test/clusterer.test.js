import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOrders, buildSignature, classifyItems, normalizeOrderLineItems } from '../src/clusterer.js';
import { chooseOperationalShippingRate, getShippingRateCarrier } from '../src/veeqo.js';

function order(id, number, lineItems, total = '10.00', deliveryMethod = '') {
  return {
    id,
    number,
    total_price: total,
    delivery_method: deliveryMethod,
    line_items: lineItems.map(([sku, quantity]) => ({
      quantity,
      sellable: { sku_code: sku, full_title: sku }
    }))
  };
}

test('builds stable signatures regardless of line item order', () => {
  const items = normalizeOrderLineItems(order(1, '#1', [
    ['PL-RW-SL30-R', 1],
    ['PL-RW-SB15-R', 1]
  ]));

  assert.equal(buildSignature(items), 'PL-RW-SB15-R:1|PL-RW-SL30-R:1');
});

test('combines repeated SKU quantities inside one order', () => {
  const items = normalizeOrderLineItems(order(1, '#1', [
    ['PL-RW-SB15-R', 1],
    ['PL-RW-SB15-R', 2]
  ]));

  assert.deepEqual(items.map(({ sku, quantity }) => ({ sku, quantity })), [
    { sku: 'PL-RW-SB15-R', quantity: 3 }
  ]);
});

test('classifies singles, kits, and combos', () => {
  assert.equal(classifyItems(normalizeOrderLineItems(order(1, '#1', [['PL-RW-SB15-R', 1]]))), 'single_qty1');
  assert.equal(classifyItems(normalizeOrderLineItems(order(2, '#2', [['PL-RW-SB15-R', 2]]))), 'single_qty2plus');
  assert.equal(classifyItems(normalizeOrderLineItems(order(3, '#3', [['PL-RW-TOR2-R', 1]]))), 'kit_small');
  assert.equal(classifyItems(normalizeOrderLineItems(order(4, '#4', [['PL-RW-TFR7-R', 1]]))), 'kit_large');
  assert.equal(classifyItems(normalizeOrderLineItems(order(5, '#5', [['PL-RW-SB15-R', 1], ['PL-RW-SL30-R', 1]]))), 'combo');
});

test('filters non-GMA and mixed orders out of included clusters', () => {
  const { clusters, summary } = analyzeOrders([
    order(1, '#1', [['PL-RW-SB15-R', 1]]),
    order(2, '#2', [['OS-NRO30-R', 1]]),
    order(3, '#3', [['PL-RW-SB15-R', 1], ['OS-NRO30-R', 1]])
  ], { threshold: 10 });

  assert.equal(clusters.length, 1);
  assert.equal(summary.gma_orders, 1);
  assert.equal(summary.included_orders, 1);
  assert.equal(summary.skipped.non_gma_only, 1);
  assert.equal(summary.skipped.mixed_gma_and_non_gma, 1);
});

test('can include all SKUs for non-GMA channel testing', () => {
  const { clusters, summary } = analyzeOrders([
    order(1, '#1', [['OS-NRO30-R', 1]]),
    order(2, '#2', [['OS-NRO30-R', 1]])
  ], { threshold: 10, requireGmaSkus: false });

  assert.equal(clusters.length, 1);
  assert.equal(summary.included_orders, 2);
  assert.equal(summary.skipped.non_gma_only, 0);
});

test('splits identical SKU clusters into carrier sub-batches', () => {
  const { clusters, subBatches, summary } = analyzeOrders([
    order(1, '#1', [['PL-RW-SB15-R', 1]], '10.00', 'USPS Ground Advantage'),
    order(2, '#2', [['PL-RW-SB15-R', 1]], '10.00', 'UPS Ground'),
    order(3, '#3', [['PL-RW-SB15-R', 1]], '10.00', '')
  ], { threshold: 2 });

  assert.equal(clusters.length, 1);
  assert.equal(subBatches.length, 3);
  assert.deepEqual(subBatches.map((batch) => batch.carrier).sort(), ['UNKNOWN', 'UPS', 'USPS']);
  assert.equal(summary.buckets.batch, 0);
  assert.equal(summary.buckets.multipack, 3);
});

test('uses Veeqo shipping-rate carrier enrichment ahead of delivery method', () => {
  const enrichedOrder = order(1, '#1', [['PL-RW-SB15-R', 1]], '10.00', 'UPS Ground');
  enrichedOrder._batch_optimizer_carrier = {
    carrier: 'USPS',
    carrier_label: 'USPS',
    carrier_source: 'USPS Ground Advantage',
    carrier_basis: 'shipping_rate'
  };

  const { subBatches } = analyzeOrders([enrichedOrder], { threshold: 2 });

  assert.equal(subBatches.length, 1);
  assert.equal(subBatches[0].carrier, 'USPS');
  assert.equal(subBatches[0].carrier_source, 'USPS Ground Advantage');
});

test('chooses a standard operational shipping rate before special mail classes', () => {
  const rate = chooseOperationalShippingRate([
    { title: 'USPS Media Mail', total_price: '4.47' },
    { title: 'USPS Ground Advantage', total_price: '5.58' },
    { title: 'UPS Ground Saver', total_price: '6.09' }
  ]);
  const carrier = getShippingRateCarrier(rate);

  assert.equal(rate.title, 'USPS Ground Advantage');
  assert.equal(carrier.carrier, 'USPS');
});
