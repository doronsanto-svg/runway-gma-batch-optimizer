import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(process.cwd(), 'data');
const cachePath = resolve(dataDir, 'shopify-issue-cache.json');
const cacheVersion = 2;

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
  if (entry?.version !== cacheVersion) return false;
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

function addressValidationIssues(shopifyOrder) {
  const summary = clean(shopifyOrder?.shippingAddress?.validationResultSummary).toUpperCase();
  if (!summary || summary === 'NO_ISSUES') return [];

  return [
    issue(
      'address',
      'Shopify Address Review',
      `Shopify shipping address validation: ${summary}. Open Shopify to review the suggested correction.`
    )
  ];
}

function mapShopifyOrderToIssues(shopifyOrder) {
  return [
    ...riskIssues(shopifyOrder),
    ...addressValidationIssues(shopifyOrder),
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
            shippingAddress {
              validationResultSummary
            }
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
  const { issueMap } = await getShopifyIssueScan(orders, { concurrency, ttlMs });
  return issueMap;
}

export async function getShopifyIssueScan(orders, { concurrency = 4, ttlMs = 10 * 60 * 1000 } = {}) {
  const issueMap = new Map();
  const summary = {
    enabled: shopifyLookupEnabled(),
    checked: 0,
    matched: 0,
    no_match: 0,
    issue_orders: 0,
    address_holds: 0,
    fraud_holds: 0,
    lookup_errors: 0,
    skipped_reason: ''
  };

  if (!summary.enabled) {
    summary.skipped_reason = 'Shopify API credentials are not configured.';
    return { issueMap, summary };
  }

  const client = new ShopifyClient();
  const cache = readCache();
  let changed = false;

  function applySummary(entry) {
    summary.checked += 1;
    if (entry.lookup_error) {
      summary.lookup_errors += 1;
      return;
    }
    if (entry.shopify_order_id || entry.shopify_gid) summary.matched += 1;
    else summary.no_match += 1;

    const issues = Array.isArray(entry.issues) ? entry.issues : [];
    if (issues.length) summary.issue_orders += 1;
    if (issues.some((issue) => issue.type === 'address')) summary.address_holds += 1;
    if (issues.some((issue) => issue.type === 'fraud')) summary.fraud_holds += 1;
  }

  async function lookup(order) {
    const key = getOrderLookupKey(order);
    if (!key) return;

    if (isCacheFresh(cache[key], ttlMs)) {
      issueMap.set(order.id, cache[key]);
      applySummary(cache[key]);
      return;
    }

    try {
      const shopifyOrder = await client.findOrderByVeeqoOrder(order);
      const entry = {
        version: cacheVersion,
        cached_at: new Date().toISOString(),
        shopify_order_id: shopifyOrder?.legacyResourceId || null,
        shopify_gid: shopifyOrder?.id || null,
        shopify_name: shopifyOrder?.name || '',
        issues: shopifyOrder ? mapShopifyOrderToIssues(shopifyOrder) : []
      };
      cache[key] = entry;
      issueMap.set(order.id, entry);
      applySummary(entry);
      changed = true;
    } catch (error) {
      const entry = {
        version: cacheVersion,
        cached_at: new Date().toISOString(),
        lookup_error: error.message,
        issues: []
      };
      cache[key] = entry;
      issueMap.set(order.id, entry);
      applySummary(entry);
      changed = true;
    }
  }

  for (let index = 0; index < orders.length; index += concurrency) {
    await Promise.all(orders.slice(index, index + concurrency).map((order) => lookup(order)));
  }

  if (changed) writeCache(cache);
  return { issueMap, summary };
}
