import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getOrderChannelName } from './veeqo.js';

export const TRACKING_CSV_HEADERS = [
  'Order Name',
  'Tracking Number',
  'Shipping Carrier',
  'Tracking URL',
  'Fulfilled At',
  'Notify Customer',
  'Veeqo Order ID',
  'Veeqo Shipment ID',
  'Veeqo Link'
];

const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(process.cwd(), 'data');
const storePath = resolve(dataDir, 'tracking-repair-audit.json');

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function firstValue(values = []) {
  return values.map(clean).find(Boolean) || '';
}

function normalizeCarrier(value) {
  const text = clean(value);
  const lower = text.toLowerCase();
  if (lower.includes('usps') || lower.includes('postal')) return 'USPS';
  if (lower.includes('ups')) return 'UPS';
  if (lower.includes('fedex') || lower.includes('federal express')) return 'FedEx';
  return text;
}

function trackingUrl(carrier, trackingNumber) {
  const number = clean(trackingNumber);
  if (!number) return '';
  const normalized = normalizeCarrier(carrier).toLowerCase();
  if (normalized === 'usps') return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(number)}`;
  if (normalized === 'ups') return `https://www.ups.com/track?tracknum=${encodeURIComponent(number)}`;
  if (normalized === 'fedex') return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(number)}`;
  return '';
}

function orderCustomer(order) {
  const customer = order?.customer || order?.deliver_to || order?.ship_to || {};
  return firstValue([
    customer.name,
    [customer.first_name, customer.last_name].filter(Boolean).join(' '),
    order?.customer_name,
    order?.deliver_to?.name
  ]);
}

function orderName(order) {
  const raw = firstValue([order?.number, order?.order_number, order?.remote_order_number, order?.reference_number]);
  if (!raw) return '';
  return raw.startsWith('#') ? raw : `#${raw}`;
}

function maybeShipmentRecords(order = {}) {
  const allocations = Array.isArray(order.allocations) ? order.allocations : [];
  return [
    order.shipment,
    ...(Array.isArray(order.shipments) ? order.shipments : []),
    ...allocations.flatMap((allocation) => [
      allocation.shipment,
      ...(Array.isArray(allocation.shipments) ? allocation.shipments : [])
    ])
  ].filter(Boolean);
}

function maybeTrackingRecords(order = {}, shipment = {}) {
  return [
    shipment.tracking_number,
    shipment.tracking_number_attributes,
    ...(Array.isArray(shipment.tracking_numbers) ? shipment.tracking_numbers : []),
    order.tracking_number,
    ...(Array.isArray(order.tracking_numbers) ? order.tracking_numbers : [])
  ].filter(Boolean);
}

function trackingNumberFromRecord(record) {
  if (typeof record === 'string' || typeof record === 'number') return clean(record);
  return firstValue([
    record?.tracking_number,
    record?.number,
    record?.value,
    record?.code
  ]);
}

function carrierFrom(order = {}, shipment = {}, trackingRecord = {}) {
  return firstValue([
    shipment?.carrier?.name,
    shipment?.carrier,
    shipment?.carrier_name,
    shipment?.shipping_carrier?.name,
    shipment?.shipping_carrier,
    trackingRecord?.carrier?.name,
    trackingRecord?.carrier,
    trackingRecord?.carrier_name,
    order?.carrier?.name,
    order?.carrier,
    order?.shipping_carrier?.name,
    order?.shipping_carrier,
    order?.delivery_method?.name,
    order?.delivery_method
  ]);
}

function shippedAt(order = {}, shipment = {}) {
  return firstValue([
    shipment?.shipped_at,
    shipment?.created_at,
    shipment?.updated_at,
    order?.shipped_at,
    order?.fulfilled_at,
    order?.updated_at
  ]);
}

function shipmentId(shipment = {}) {
  return clean(shipment?.id || shipment?.shipment_id);
}

function veeqoLink(order, config = {}) {
  const template = config.veeqoOrderUrlTemplate || '';
  const id = clean(order?.id);
  if (template) {
    return template
      .replaceAll('{order_id}', encodeURIComponent(id))
      .replaceAll('{order_number}', encodeURIComponent(orderName(order)))
      .replaceAll('{remote_id}', encodeURIComponent(clean(order?.remote_id || order?.fulfillment_channel_order?.remote_id)));
  }
  const base = config.veeqoOrdersUrl || 'https://app.veeqo.com/orders';
  return id ? `${base}/${encodeURIComponent(id)}` : base;
}

export function trackingRowsFromOrders(orders = [], { channelFilter = '', config = {} } = {}) {
  const channelNeedle = clean(channelFilter).toLowerCase();
  const rows = [];

  for (const order of orders || []) {
    const channel = getOrderChannelName(order);
    if (channelNeedle && clean(channel).toLowerCase() !== channelNeedle) continue;

    const shipments = maybeShipmentRecords(order);
    const shipmentList = shipments.length ? shipments : [{}];
    for (const shipment of shipmentList) {
      const trackingRecords = maybeTrackingRecords(order, shipment);
      const trackingList = trackingRecords.length ? trackingRecords : [{}];
      for (const trackingRecord of trackingList) {
        const trackingNumber = trackingNumberFromRecord(trackingRecord);
        const carrier = normalizeCarrier(carrierFrom(order, shipment, trackingRecord));
        const name = orderName(order);
        const reasons = [];
        if (!name) reasons.push('Missing order number.');
        if (!trackingNumber) reasons.push('Missing tracking number.');
        if (!carrier) reasons.push('Missing carrier.');

        rows.push({
          key: `${clean(order?.id)}:${shipmentId(shipment)}:${trackingNumber || 'missing'}`,
          eligible: reasons.length === 0,
          reasons,
          order_id: clean(order?.id),
          order_name: name,
          customer: orderCustomer(order),
          carrier,
          tracking_number: trackingNumber,
          tracking_url: firstValue([
            trackingRecord?.tracking_url,
            shipment?.tracking_url,
            trackingUrl(carrier, trackingNumber)
          ]),
          fulfilled_at: shippedAt(order, shipment),
          veeqo_shipment_id: shipmentId(shipment),
          veeqo_link: veeqoLink(order, config)
        });
      }
    }
  }

  const seen = new Set();
  return rows.filter((row) => {
    const uniqueKey = `${row.order_name}|${row.tracking_number}|${row.veeqo_shipment_id}`;
    if (seen.has(uniqueKey)) return false;
    seen.add(uniqueKey);
    return true;
  }).sort((a, b) => a.order_name.localeCompare(b.order_name));
}

function csvEscape(value) {
  const text = clean(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function rowsToTrackingCsv(rows = []) {
  const lines = [TRACKING_CSV_HEADERS.join(',')];
  for (const row of rows.filter((item) => item.eligible)) {
    lines.push([
      row.order_name,
      row.tracking_number,
      row.carrier,
      row.tracking_url,
      row.fulfilled_at,
      'FALSE',
      row.order_id,
      row.veeqo_shipment_id,
      row.veeqo_link
    ].map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function readTrackingAudit() {
  if (!existsSync(storePath)) return { exports: [] };
  return JSON.parse(readFileSync(storePath, 'utf8'));
}

function writeTrackingAudit(store) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2));
  return store;
}

export function recordTrackingExport({ rows = [], filename, now = new Date().toISOString() }) {
  const store = readTrackingAudit();
  const record = {
    id: `tracking-export-${Date.now()}`,
    status: 'exported',
    filename,
    exported_at: now,
    uploaded_at: null,
    rows: rows.filter((row) => row.eligible).map((row) => ({
      order_id: row.order_id,
      order_name: row.order_name,
      tracking_number: row.tracking_number,
      carrier: row.carrier,
      veeqo_shipment_id: row.veeqo_shipment_id
    }))
  };
  store.exports = [record, ...(store.exports || [])].slice(0, 100);
  writeTrackingAudit(store);
  return record;
}

export function markTrackingExportUploaded(exportId, now = new Date().toISOString()) {
  const store = readTrackingAudit();
  const index = (store.exports || []).findIndex((record) => record.id === exportId);
  if (index === -1) return null;
  store.exports[index] = {
    ...store.exports[index],
    status: 'uploaded',
    uploaded_at: now
  };
  writeTrackingAudit(store);
  return store.exports[index];
}
