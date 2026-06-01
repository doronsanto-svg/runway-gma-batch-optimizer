import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(process.cwd(), 'data');
const cachePath = resolve(dataDir, 'shopify-issue-cache.json');

function clean(value) {
  return typeof value === 'string' ? value.trim() : String(value || '').trim();
}

function readCache() {
  if (!existsSync(cachePath)) return {};
  return JSON.parse(readFileSync(cachePath, 'utf8'));
}

function writeCache(cache) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

function normalizeShopDomain(domain) {
  return clean(domain).replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function getOrderLookupKey(order) {
  return clean(order?.fulfillment_channel_order?.remote_id || order?.remote_id || order?.number || order?.sales_record_number);
}

function getOrderSearchQuery(order) {
  const number = clean(order?.number || order?.sales_record_number);
  if (!number) return '';
  return `name:${number}`;
}

function isCacheFresh(entry, ttlMs) {
  if (!entry?.cached_at) return false;
  return Date.now() - new Date(entry.cached_at).getTime() < ttlMs;
}

function issue(type, label, detail, source = 'Shopify') {
  return {
    type,
    label,
    severity: 'hold',
    detail,
    source
  };
}

function riskIssues(shopifyOrder) {
  const issues = [];
  const risk = shopifyOrder?.risk || {};
  const recommendation = clean(risk.recommendation).toUpperCase();
  const assessments = Array.isArray(risk.assessments) ? risk.assessments : [];
  const levels = assessments.map((assessment) => clean(assessment.riskLevel).toUpperCase()).filter(Boolean);
  const mediumOrHigh = levels.some((level) => level.includes('MEDIUM') || level.includes('HIGH'));

  if (recommendation && !['ACCEPT', 'NONE', 'LOW'].includes(recommendation)) {
    issues.push(issue('fraud', 'Shopify Fraud Hold', `Shopify risk recommendation: ${recommendation}.`));
  } else if (mediumOrHigh) {
    issues.push(issue('fraud', 'Shopify Fraud Hold', `Shopify risk level: ${levels.join(', ')}.`));
  }

  return issues;
}

function addressTagIssues(shopifyOrder) {
  const tags = Array.isArray(shopifyOrder?.tags) ? shopifyOrder.tags : [];
  const addressTags = tags.filter((tag) => /address|verify|invalid|undeliverable/i.test(tag) && /hold|review|verify|invalid|undeliverable/i.test(tag));
  if (!addressTags.length) return [];

  return [
    issue('address', 'Shopify Address Hold', `Shopify tag: ${addressTags.join(', ')}.`)
  ];
}

function mapShopifyOrderToIssues(shopifyOrder) {
  return [
    ...riskIssues(shopifyOrder),
    ...addressTagIssues(shopifyOrder)
  ];
}

export function shopifyLookupEnabled() {
  return Boolean(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ADMIN_ACCESS_TOKEN);
}

export class ShopifyClient {
  constructor({
    storeDomain = process.env.SHOPIFY_STORE_DOMAIN,
    accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
    apiVersion = process.env.SHOPIFY_API_VERSION || '2026-04'
  } = {}) {
    this.storeDomain = normalizeShopDomain(storeDomain);
    this.accessToken = accessToken;
    this.apiVersion = apiVersion;
  }

  async graphql(query, variables = {}) {
    const response = await fetch(`https://${this.storeDomain}/admin/api/${this.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.accessToken
      },
      body: JSON.stringify({ query, variables })
    });

    const body = await response.json();
    if (!response.ok || body.errors) {
      throw new Error(JSON.stringify(body.errors || body));
    }
    return body.data;
  }

  async findOrderByVeeqoOrder(order) {
    const search = getOrderSearchQuery(order);
    if (!search) return null;

    const data = await this.graphql(`
      query FillementOrderRisk($query: String!) {
        orders(first: 1, query: $query) {
          nodes {
            id
            legacyResourceId
            name
            tags
            risk {
              recommendation
              assessments {
                riskLevel
              }
            }
          }
        }
      }
    `, { query: search });

    return data?.orders?.nodes?.[0] || null;
  }
}

export async function getShopifyIssueMap(orders, { concurrency = 4, ttlMs = 10 * 60 * 1000 } = {}) {
  if (!shopifyLookupEnabled()) return new Map();

  const client = new ShopifyClient();
  const cache = readCache();
  const result = new Map();
  let changed = false;

  async function lookup(order) {
    const key = getOrderLookupKey(order);
    if (!key) return;

    if (isCacheFresh(cache[key], ttlMs)) {
      result.set(order.id, cache[key]);
      return;
    }

    try {
      const shopifyOrder = await client.findOrderByVeeqoOrder(order);
      const entry = {
        cached_at: new Date().toISOString(),
        shopify_order_id: shopifyOrder?.legacyResourceId || null,
        shopify_gid: shopifyOrder?.id || null,
        shopify_name: shopifyOrder?.name || '',
        issues: shopifyOrder ? mapShopifyOrderToIssues(shopifyOrder) : []
      };
      cache[key] = entry;
      result.set(order.id, entry);
      changed = true;
    } catch (error) {
      const entry = {
        cached_at: new Date().toISOString(),
        lookup_error: error.message,
        issues: []
      };
      cache[key] = entry;
      result.set(order.id, entry);
      changed = true;
    }
  }

  for (let index = 0; index < orders.length; index += concurrency) {
    await Promise.all(orders.slice(index, index + concurrency).map((order) => lookup(order)));
  }

  if (changed) writeCache(cache);
  return result;
}
