import { loadEnv, requireEnv } from '../src/env.js';
import { VeeqoClient } from '../src/veeqo.js';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--order-ids') {
      args.orderIds = argv[index + 1].split(',').map((id) => Number.parseInt(id.trim(), 10)).filter(Number.isFinite);
      index += 1;
    } else if (token === '--tag') {
      args.tag = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

async function main() {
  loadEnv();

  const args = parseArgs(process.argv.slice(2));
  if (!args.orderIds?.length) {
    throw new Error('Pass explicit test order IDs: npm run tag:test -- --order-ids 123,456');
  }

  const apiKey = requireEnv('VEEQO_API_KEY');
  const baseUrl = process.env.VEEQO_BASE_URL || 'https://api.veeqo.com';
  const client = new VeeqoClient({ apiKey, baseUrl });
  const tagName = args.tag || `BATCH-TEST-${Date.now()}`;
  const tag = await client.findOrCreateTag({ name: tagName, colour: '#f5df9e' });

  await client.tagOrders({ orderIds: args.orderIds, tagIds: [tag.id] });
  console.log(`Applied tag "${tag.name}" (${tag.id}) to ${args.orderIds.length} test order(s).`);
  console.log('Verify in Veeqo, then remove with:');
  console.log(`npm run untag:test -- --order-ids ${args.orderIds.join(',')} --tag "${tag.name}"`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

