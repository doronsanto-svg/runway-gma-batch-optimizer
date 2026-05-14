import { loadEnv, requireEnv } from '../src/env.js';
import { VeeqoClient } from '../src/veeqo.js';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--order-ids') {
      args.orderIds = argv[index + 1].split(',').map((id) => Number.parseInt(id.trim(), 10)).filter(Number.isFinite);
      index += 1;
    }
  }
  return args;
}

function tagNames(order) {
  return Array.isArray(order.tags) ? order.tags.map((tag) => tag.name || tag) : [];
}

async function main() {
  loadEnv();

  const args = parseArgs(process.argv.slice(2));
  if (!args.orderIds?.length) throw new Error('Pass order IDs: npm run inspect:orders -- --order-ids 123,456');

  const apiKey = requireEnv('VEEQO_API_KEY');
  const baseUrl = process.env.VEEQO_BASE_URL || 'https://api.veeqo.com';
  const client = new VeeqoClient({ apiKey, baseUrl });

  for (const orderId of args.orderIds) {
    const order = await client.getOrder(orderId);
    console.log(`${order.number}: id=${order.id}, status=${order.status}, tags=${tagNames(order).join('|') || 'none'}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

