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
  if (!args.orderIds?.length || !args.tag) {
    throw new Error('Pass explicit test order IDs and tag: npm run untag:test -- --order-ids 123,456 --tag "BATCH-TEST-..."');
  }

  const apiKey = requireEnv('VEEQO_API_KEY');
  const baseUrl = process.env.VEEQO_BASE_URL || 'https://api.veeqo.com';
  const client = new VeeqoClient({ apiKey, baseUrl });
  const tags = await client.listTags();
  const tag = tags.find((candidate) => candidate.name === args.tag);
  if (!tag) throw new Error(`Tag not found: ${args.tag}`);

  await client.untagOrders({ orderIds: args.orderIds, tagIds: [tag.id] });
  console.log(`Removed tag "${tag.name}" (${tag.id}) from ${args.orderIds.length} test order(s).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

