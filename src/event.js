export const CBS_EVENT_ID = 'cbs_deals';
export const GMA_EVENT_ID = 'gma';
export const LEGACY_EVENT_ID = 'legacy_unscoped';

export const EVENT_PROFILES = {
  [CBS_EVENT_ID]: {
    id: CBS_EVENT_ID,
    label: 'CBS Deals',
    order_prefix: 'CBS',
    persistent_tag: 'CBS-DEALS'
  },
  [GMA_EVENT_ID]: {
    id: GMA_EVENT_ID,
    label: 'GMA Legacy',
    order_prefix: '',
    persistent_tag: ''
  }
};

export function canonicalOrderNumber(orderOrNumber) {
  const raw = typeof orderOrNumber === 'object' && orderOrNumber !== null
    ? orderOrNumber.number || orderOrNumber.order_number || orderOrNumber.remote_order_number || orderOrNumber.reference_number || ''
    : orderOrNumber;
  return String(raw || '').trim().replace(/^[^a-z0-9]+/i, '').toUpperCase();
}

export function isCbsOrder(orderOrNumber) {
  return canonicalOrderNumber(orderOrNumber).slice(0, 3) === 'CBS';
}

export function orderMatchesEvent(order, eventId = CBS_EVENT_ID) {
  if (eventId === CBS_EVENT_ID) return isCbsOrder(order);
  return true;
}

export function inferRecordEventId(record = {}) {
  if (record.event_id) return record.event_id;
  const numbers = Array.isArray(record.order_numbers) ? record.order_numbers.filter(Boolean) : [];
  if (numbers.length && numbers.every(isCbsOrder)) return CBS_EVENT_ID;
  if (record.mode === 'demo' || numbers.length) return GMA_EVENT_ID;
  return LEGACY_EVENT_ID;
}

export function eventProfile(eventId = CBS_EVENT_ID) {
  return EVENT_PROFILES[eventId] || EVENT_PROFILES[CBS_EVENT_ID];
}
