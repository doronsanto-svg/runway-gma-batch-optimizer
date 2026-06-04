import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKING_CSV_HEADERS, rowsToTrackingCsv, trackingRowsFromOrders } from '../src/tracking-repair.js';

const channel = { name: 'Runway by Christian Siriano' };

test('trackingRowsFromOrders extracts eligible shipment tracking rows', () => {
  const rows = trackingRowsFromOrders([{
    id: 123,
    number: 'Gchristiansiriano1001',
    channel,
    customer: { first_name: 'Kathy', last_name: 'Dixie' },
    shipments: [{
      id: 987,
      carrier: 'USPS Ground Advantage',
      tracking_number: '9400111899223855555555',
      shipped_at: '2026-06-01T15:00:00Z'
    }]
  }], { channelFilter: 'Runway by Christian Siriano' });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].eligible, true);
  assert.equal(rows[0].order_name, '#Gchristiansiriano1001');
  assert.equal(rows[0].customer, 'Kathy Dixie');
  assert.equal(rows[0].carrier, 'USPS');
  assert.equal(rows[0].tracking_url, 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223855555555');
});

test('trackingRowsFromOrders keeps missing tracking rows visible but not eligible', () => {
  const rows = trackingRowsFromOrders([{
    id: 124,
    number: '#Gchristiansiriano1002',
    channel,
    shipments: [{ id: 988, carrier: 'UPS Ground' }]
  }], { channelFilter: 'Runway by Christian Siriano' });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].eligible, false);
  assert.deepEqual(rows[0].reasons, ['Missing tracking number.']);
  assert.equal(rows[0].carrier, 'UPS');
});

test('rowsToTrackingCsv uses exact Shopify correction headers and excludes ineligible rows', () => {
  const csv = rowsToTrackingCsv([
    {
      eligible: true,
      order_name: '#Gchristiansiriano1001',
      tracking_number: '1Z9999999999999999',
      carrier: 'UPS',
      tracking_url: 'https://www.ups.com/track?tracknum=1Z9999999999999999',
      fulfilled_at: '2026-06-01T15:00:00Z',
      order_id: '123',
      veeqo_shipment_id: '987',
      veeqo_link: 'https://app.veeqo.com/orders/123'
    },
    {
      eligible: false,
      order_name: '#Gchristiansiriano1002',
      tracking_number: '',
      carrier: 'USPS'
    }
  ]);

  const lines = csv.trim().split('\n');
  assert.equal(lines[0], TRACKING_CSV_HEADERS.join(','));
  assert.equal(lines.length, 2);
  assert.match(lines[1], /#Gchristiansiriano1001,1Z9999999999999999,UPS/);
  assert.match(lines[1], /,FALSE,123,987,https:\/\/app\.veeqo\.com\/orders\/123$/);
  assert.doesNotMatch(csv, /Gchristiansiriano1002/);
});
