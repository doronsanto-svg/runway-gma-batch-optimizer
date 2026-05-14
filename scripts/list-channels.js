import { loadEnv, requireEnv } from '../src/env.js';
import { getOrderChannelName, VeeqoClient } from '../src/veeqo.js';

async function main() {
  loadEnv();

  const apiKey = requireEnv('VEEQO_API_KEY');
  const baseUrl = process.env.VEEQO_BASE_URL || 'https://api.veeqo.com';
  const status = process.env.VEEQO_ANALYZE_STATUS || process.env.VEEQO_API_CHECK_STATUS || 'awaiting_fulfillment';

  const client = new VeeqoClient({ apiKey, baseUrl });
  const { orders } = await client.listAllOrders({ status, pageSize: 100 });
  const summary = new Map();

  for (const order of orders) {
    const name = getOrderChannelName(order);
    summary.set(name, (summary.get(name) || 0) + 1);
  }

  console.log(`Ready-to-ship channels/stores for status=${status}:`);
  for (const [name, count] of [...summary.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`- ${name}: ${count}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
