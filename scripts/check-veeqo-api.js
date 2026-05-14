import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv() {
  const envPath = existsSync(resolve(process.cwd(), '.env'))
    ? resolve(process.cwd(), '.env')
    : resolve(process.cwd(), '.env.example');
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.includes('put_your_key_here')) {
    throw new Error(`${name} is missing. Add it to .env first.`);
  }
  return value;
}

function getSku(lineItem) {
  return (
    lineItem?.sellable?.sku_code ||
    lineItem?.sellable?.sku ||
    lineItem?.sku_code ||
    lineItem?.sku ||
    null
  );
}

function summarizeOrder(order) {
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    created_at: order.created_at,
    tags: Array.isArray(order.tags) ? order.tags.map((tag) => tag.name || tag).slice(0, 5) : [],
    line_items: lineItems.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      sku: getSku(item),
      title: item?.sellable?.full_title || item?.title || item?.name || null
    }))
  };
}

async function requestJson(url, apiKey) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    }
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text.slice(0, 500);
  }

  return { response, body };
}

async function main() {
  loadEnv();

  const apiKey = requireEnv('VEEQO_API_KEY');
  const baseUrl = process.env.VEEQO_BASE_URL || 'https://api.veeqo.com';
  const status = process.env.VEEQO_API_CHECK_STATUS || 'awaiting_fulfillment';
  const pageSize = process.env.VEEQO_API_CHECK_PAGE_SIZE || '5';

  const ordersUrl = new URL('/orders', baseUrl);
  ordersUrl.searchParams.set('status', status);
  ordersUrl.searchParams.set('page_size', pageSize);
  ordersUrl.searchParams.set('page', '1');

  console.log('Checking Veeqo API connection...');
  console.log(`Orders endpoint: ${ordersUrl.origin}${ordersUrl.pathname}?status=${status}&page_size=${pageSize}&page=1`);

  const ordersResult = await requestJson(ordersUrl, apiKey);
  console.log(`Orders status: ${ordersResult.response.status}`);
  console.log(`Orders total count: ${ordersResult.response.headers.get('x-total-count') || 'not provided'}`);
  console.log(`Orders total pages: ${ordersResult.response.headers.get('x-total-pages-count') || 'not provided'}`);

  if (!ordersResult.response.ok) {
    console.error('Orders response body:', ordersResult.body);
    process.exit(1);
  }

  const orders = Array.isArray(ordersResult.body) ? ordersResult.body : [];
  console.log(`Orders returned on first page: ${orders.length}`);
  console.log(JSON.stringify(orders.slice(0, 3).map(summarizeOrder), null, 2));

  const tagsUrl = new URL('/tags', baseUrl);
  const tagsResult = await requestJson(tagsUrl, apiKey);
  console.log(`Tags status: ${tagsResult.response.status}`);

  if (!tagsResult.response.ok) {
    console.error('Tags response body:', tagsResult.body);
    process.exit(1);
  }

  const tags = Array.isArray(tagsResult.body) ? tagsResult.body : [];
  console.log(`Tags returned: ${tags.length}`);
  console.log(JSON.stringify(tags.slice(0, 10).map((tag) => ({
    id: tag.id,
    name: tag.name,
    colour: tag.colour,
    taggings_count: tag.taggings_count
  })), null, 2));

  console.log('Read-only Veeqo API check complete.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
