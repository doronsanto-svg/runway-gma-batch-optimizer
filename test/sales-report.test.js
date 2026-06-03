import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductSalesSnapshotReport, buildSalesReport } from '../src/sales-report.js';
import { shopifyProductSalesSnapshot } from '../src/sales-snapshot.js';

function order({ id, number, channel = 'Runway by Christian Siriano', lineItems = [] }) {
  return {
    id,
    number,
    channel: { name: channel },
    line_items: lineItems.map((item) => ({
      quantity: item.quantity,
      sellable: {
        sku_code: item.sku,
        full_title: item.title || item.sku
      }
    }))
  };
}

test('buildSalesReport expands kits into single unit totals and splits processed status', () => {
  const report = buildSalesReport({
    channelFilter: 'Runway by Christian Siriano',
    completedOrderIds: new Set(['1']),
    orders: [
      order({
        id: '1',
        number: '#1001',
        lineItems: [
          { sku: 'PL-RW-TOR2-R', quantity: 2 },
          { sku: 'PL-RW-FT72-R', quantity: 1 }
        ]
      }),
      order({
        id: '2',
        number: '#1002',
        lineItems: [
          { sku: 'PL-RW-AA90-R', quantity: 1 }
        ]
      }),
      order({
        id: '3',
        number: '#1003',
        channel: 'Runway',
        lineItems: [
          { sku: 'PL-RW-AA90-R', quantity: 10 }
        ]
      })
    ]
  });

  const allAccess = report.products.find((row) => row.sku === 'PL-RW-AA90-R');
  const stageBright = report.products.find((row) => row.sku === 'PL-RW-SB15-R');
  const finishingTouch = report.products.find((row) => row.sku === 'PL-RW-FT72-R');
  const overnight = report.kits.find((row) => row.sku === 'PL-RW-TOR2-R');

  assert.equal(report.summary.source_orders, 2);
  assert.equal(report.summary.processed_orders, 1);
  assert.equal(report.summary.unprocessed_orders, 1);
  assert.equal(allAccess.sold, 3);
  assert.equal(allAccess.processed, 2);
  assert.equal(allAccess.unprocessed, 1);
  assert.equal(stageBright.sold, 2);
  assert.equal(finishingTouch.sold, 1);
  assert.equal(overnight.sold, 2);
  assert.equal(report.summary.single_units_sold, 6);
});

test('buildSalesReport tracks kit top sellers separately from physical single units', () => {
  const report = buildSalesReport({
    orders: [
      order({
        id: '1',
        number: '#1001',
        lineItems: [
          { sku: 'PL-RW-TFR7-R', quantity: 1 },
          { sku: 'PL-RW-TOR2-R', quantity: 3 }
        ]
      })
    ]
  });

  assert.equal(report.summary.kits_sold, 4);
  assert.equal(report.top_kits[0].sku, 'PL-RW-TOR2-R');
  assert.equal(report.top_kits[0].sold, 3);
  assert.equal(report.top_single_units[0].sold, 4);
});

test('buildProductSalesSnapshotReport matches Shopify product count snapshot and expands kits', () => {
  const report = buildProductSalesSnapshotReport({ productSales: shopifyProductSalesSnapshot });
  const bySku = new Map(report.products.map((row) => [row.sku, row]));
  const kitsBySku = new Map(report.kits.map((row) => [row.sku, row]));

  assert.equal(report.summary.single_units_sold + report.summary.kits_sold, 4142);
  assert.equal(report.summary.single_units_expanded, 6832);
  assert.equal(kitsBySku.get('PL-RW-TOR2-R').sold, 1060);
  assert.equal(bySku.get('PL-RW-SB15-R').sold, 676);
  assert.equal(bySku.get('PL-RW-SB15-R').expanded_units, 1968);
  assert.equal(bySku.get('PL-RW-AA90-R').expanded_units, 1729);
  assert.equal(bySku.get('PL-RW-FT72-R').expanded_units, 1004);
  assert.equal(bySku.get('PL-RW-BTS100-R').expanded_units, 414);
});
