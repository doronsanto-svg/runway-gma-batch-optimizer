import { loadEnv, requireEnv } from '../src/env.js';
import { getOrderChannelName, VeeqoClient } from '../src/veeqo.js';

const STATUSES = [
  'awaiting_fulfillment',
  'awaiting_payment',
  'awaiting_stock',
  'on_hold'
];

function tagNames(order) {
  return Array.isArray(order.tags) ? order.tags.map((tag) => tag.name || tag) : [];
}

function isTestOrder(order) {
  const values = [
    order.number,
    order.order_remote_id,
    order.customer?.email,
    order.customer_email,
    order.notes,
    ...tagNames(order)
  ].filter(Boolean).map(String);
  return values.some((value) => value.includes('GMA-TEST') || value.includes('GMA-TEST-IMPORT'));
}

async function main() {
  loadEnv();

  const apiKey = requireEnv('VEEQO_API_KEY');
  const baseUrl = process.env.VEEQO_BASE_URL || 'https://api.veeqo.com';
  const client = new VeeqoClient({ apiKey, baseUrl });
  const matches = [];
  const channelSummary = new Map();
  const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 48);

  for (const status of STATUSES) {
    const { orders } = await client.listAllOrders({ status, pageSize: 100, maxPages: 5 });
    for (const order of orders) {
      if (order.created_at && new Date(order.created_at) < cutoff) continue;
      const channel = getOrderChannelName(order);
      const key = `${status} | ${channel}`;
      channelSummary.set(key, (channelSummary.get(key) || 0) + 1);
      if (isTestOrder(order)) matches.push({ status, channel, order });
    }
  }

  console.log('Status/channel summary from scanned statuses:');
  for (const [key, count] of [...channelSummary.entries()].sort()) {
    console.log(`- ${key}: ${count}`);
  }

  if (!matches.length) {
    console.log('\nNo imported GMA-TEST orders found in scanned statuses.');
    return;
  }

  console.log(`\nFound ${matches.length} imported test order(s):`);
  for (const match of matches.slice(0, 80)) {
    console.log(`- ${match.order.number}: id=${match.order.id}, status=${match.status}, channel=${match.channel}, tags=${tagNames(match.order).join('|') || 'none'}`);
  }
  if (matches.length > 80) console.log(`...and ${matches.length - 80} more`);
  console.log(`\nOrder IDs: ${matches.map((match) => match.order.id).join(',')}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
