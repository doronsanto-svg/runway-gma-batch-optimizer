import { loadEnv, requireEnv } from '../src/env.js';
import { GMA_SKUS } from '../src/constants.js';
import { getLineItemSku, VeeqoClient } from '../src/veeqo.js';

function isPrimitive(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function hasGmaSku(order) {
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  return lineItems.some((item) => Boolean(GMA_SKUS[getLineItemSku(item)]));
}

function pickLikelyMoneyFields(order) {
  const picked = {};
  for (const [key, value] of Object.entries(order)) {
    const normalized = key.toLowerCase();
    if (
      isPrimitive(value) &&
      (normalized.includes('total') ||
        normalized.includes('price') ||
        normalized.includes('amount') ||
        normalized.includes('revenue') ||
        normalized.includes('subtotal') ||
        normalized.includes('payment'))
    ) {
      picked[key] = value;
    }
  }
  return picked;
}

async function main() {
  loadEnv();

  const apiKey = requireEnv('VEEQO_API_KEY');
  const baseUrl = process.env.VEEQO_BASE_URL || 'https://api.veeqo.com';
  const status = process.env.VEEQO_ANALYZE_STATUS || process.env.VEEQO_API_CHECK_STATUS || 'awaiting_fulfillment';

  const client = new VeeqoClient({ apiKey, baseUrl });
  const { orders } = await client.listAllOrders({ status, pageSize: 100 });
  const order = orders.find(hasGmaSku) || orders[0];

  if (!order) {
    console.log('No orders returned.');
    return;
  }

  console.log(`Inspecting order ${order.number || order.id}`);
  console.log('Top-level keys:');
  console.log(Object.keys(order).sort().join(', '));
  console.log('\nLikely money fields:');
  console.log(JSON.stringify(pickLikelyMoneyFields(order), null, 2));
  console.log('\nChannel/store field:');
  console.log(JSON.stringify(order.channel || null, null, 2));
  console.log('\nPrimitive metadata fields:');
  console.log(JSON.stringify(Object.fromEntries(
    Object.entries(order)
      .filter(([key, value]) => isPrimitive(value) && !String(key).toLowerCase().includes('address'))
      .slice(0, 80)
  ), null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
