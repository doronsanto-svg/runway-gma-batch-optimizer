import { loadEnv, requireEnv } from '../src/env.js';
import { getOrderChannelName, VeeqoClient } from '../src/veeqo.js';

function tagNames(order) {
  return Array.isArray(order.tags) ? order.tags.map((tag) => tag.name || tag) : [];
}

async function main() {
  loadEnv();

  const apiKey = requireEnv('VEEQO_API_KEY');
  const baseUrl = process.env.VEEQO_BASE_URL || 'https://api.veeqo.com';
  const status = process.env.VEEQO_ANALYZE_STATUS || process.env.VEEQO_API_CHECK_STATUS || 'awaiting_fulfillment';
  const channelFilter = process.env.VEEQO_CHANNEL_FILTER || 'Runway by Christian Siriano';
  const client = new VeeqoClient({ apiKey, baseUrl });
  const { orders } = await client.listAllOrders({ status, pageSize: 100 });
  const matches = orders.filter((order) => {
    const number = String(order.number || '');
    const tags = tagNames(order);
    return getOrderChannelName(order).toLowerCase() === channelFilter.toLowerCase() &&
      (number.startsWith('GMA-TEST-') || tags.includes('GMA-TEST-IMPORT'));
  });

  if (!matches.length) {
    console.log(`No imported test orders found in ${channelFilter} with status=${status}.`);
    return;
  }

  console.log(`Found ${matches.length} imported test order(s):`);
  for (const order of matches) {
    console.log(`- ${order.number}: id=${order.id}, tags=${tagNames(order).join('|') || 'none'}`);
  }
  console.log(`\nOrder IDs: ${matches.map((order) => order.id).join(',')}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

