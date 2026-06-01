import { DEFAULT_THRESHOLD } from './constants.js';
import { loadEnv, requireEnv } from './env.js';
import { analyzeOrders } from './clusterer.js';
import {
  chooseOperationalShippingRate,
  getOrderChannelName,
  getPrimaryAllocationId,
  getShippingRateCarrier,
  VeeqoClient
} from './veeqo.js';
import { buildReportPayload, writeReports } from './report.js';
import { buildDemoOrders } from './demo-orders.js';
import { analyzeOrderIssues, summarizeOrderIssues } from './order-issues.js';
import { readCarrierCache, writeCarrierCache } from './carrier-cache.js';
import { getShopifyIssueScan } from './shopify.js';

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

async function enrichOrdersWithOperationalCarriers(orders, client, { concurrency = 4, refresh = false } = {}) {
  let enriched = 0;
  let fallback = 0;
  let failed = 0;
  let cached = 0;
  let cacheMiss = 0;
  const cache = readCarrierCache();
  let cacheChanged = false;

  async function enrich(order) {
    let orderForRates = order;
    let allocationId = getPrimaryAllocationId(orderForRates);
    if (!allocationId && order?.id) {
      orderForRates = await client.getOrder(order.id);
      allocationId = getPrimaryAllocationId(orderForRates);
    }

    if (!allocationId) {
      fallback += 1;
      return;
    }

    const cacheKey = String(allocationId);
    if (cache[cacheKey]?.carrier) {
      order._batch_optimizer_carrier = {
        ...cache[cacheKey],
        carrier_basis: 'shipping_rate_cache'
      };
      cached += 1;
      return;
    }

    if (!refresh) {
      cacheMiss += 1;
      fallback += 1;
      return;
    }

    try {
      const rates = await client.getShippingRates(allocationId);
      const rate = chooseOperationalShippingRate(rates);
      if (!rate) {
        fallback += 1;
        return;
      }

      const carrierInfo = getShippingRateCarrier(rate);
      order._batch_optimizer_carrier = {
        ...carrierInfo,
        carrier_source: rate.title || rate.name || rate.service_name || carrierInfo.carrier_source,
        carrier_basis: 'shipping_rate'
      };
      cache[cacheKey] = {
        carrier: order._batch_optimizer_carrier.carrier,
        carrier_label: order._batch_optimizer_carrier.carrier_label,
        carrier_source: order._batch_optimizer_carrier.carrier_source,
        cached_at: new Date().toISOString()
      };
      cacheChanged = true;
      enriched += 1;
    } catch {
      failed += 1;
      fallback += 1;
    }
  }

  for (let index = 0; index < orders.length; index += concurrency) {
    const group = orders.slice(index, index + concurrency);
    await Promise.all(group.map((order) => enrich(order)));
  }

  if (cacheChanged) writeCarrierCache(cache);

  return { enriched, cached, cache_miss: cacheMiss, fallback, failed };
}

export function parseAnalyzeArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--channel') {
      args.channel = argv[index + 1];
      index += 1;
    } else if (token === '--all-skus') {
      args.allSkus = true;
    } else if (token === '--threshold') {
      args.threshold = Number.parseInt(argv[index + 1], 10);
      index += 1;
    } else if (token === '--demo') {
      args.demo = true;
    }
  }
  return args;
}

export function splitHeldOrders(orders, issueRecords) {
  const heldOrderIds = new Set(issueRecords.filter((issue) => issue.hold).map((issue) => issue.order_id));
  return {
    heldOrderIds,
    batchableOrders: orders.filter((order) => !heldOrderIds.has(order.id))
  };
}

export async function runReadOnlyAnalysis(options = {}) {
  loadEnv();

  const baseUrl = process.env.VEEQO_BASE_URL || 'https://api.veeqo.com';
  const status = options.status || process.env.VEEQO_ANALYZE_STATUS || process.env.VEEQO_API_CHECK_STATUS || 'awaiting_fulfillment';
  const pageSize = Number.parseInt(options.pageSize || process.env.VEEQO_ANALYZE_PAGE_SIZE || '100', 10);
  const threshold = options.threshold || Number.parseInt(process.env.DEFAULT_THRESHOLD || String(DEFAULT_THRESHOLD), 10);
  const channelFilter = options.channel || process.env.VEEQO_CHANNEL_FILTER || 'Runway by Christian Siriano';
  const requireGmaSkus = options.allSkus ? false : process.env.REQUIRE_GMA_SKUS !== 'false';
  const refreshCarriers = Boolean(options.refreshCarriers);
  const useShippingRates = refreshCarriers || parseBoolean(options.useShippingRates ?? process.env.VEEQO_USE_SHIPPING_RATES, true);
  const rateConcurrency = Number.parseInt(process.env.VEEQO_RATE_LOOKUP_CONCURRENCY || '4', 10);
  const shopifyIssueCacheTtlMs = Number.parseInt(process.env.SHOPIFY_ISSUE_CACHE_TTL_MS || '0', 10);

  let orders;
  let totalCount;
  let totalPages;
  let dataSource = 'live Veeqo';
  let carrierLookup = {
    basis: options.demo ? 'demo_delivery_method' : 'delivery_method_fallback',
    enriched: 0,
    cached: 0,
    cache_miss: 0,
    fallback: 0,
    failed: 0
  };

  if (options.demo) {
    orders = buildDemoOrders();
    totalCount = orders.length;
    totalPages = 1;
    dataSource = 'demo test data';
  } else {
    const apiKey = requireEnv('VEEQO_API_KEY');
    const client = new VeeqoClient({ apiKey, baseUrl });
    const result = await client.listAllOrders({ status, pageSize });
    orders = result.orders;
    totalCount = result.totalCount;
    totalPages = result.totalPages;

    if (useShippingRates) {
      const channelOrdersForRates = orders.filter((order) => getOrderChannelName(order).toLowerCase() === channelFilter.toLowerCase());
      const result = await enrichOrdersWithOperationalCarriers(channelOrdersForRates, client, {
        concurrency: Number.isFinite(rateConcurrency) && rateConcurrency > 0 ? rateConcurrency : 4,
        refresh: refreshCarriers
      });
      carrierLookup = {
        basis: refreshCarriers ? 'shipping_rate_with_delivery_method_fallback' : 'fast_cached_delivery_fallback',
        ...result
      };
    }
  }

  const channelOrders = orders.filter((order) => getOrderChannelName(order).toLowerCase() === channelFilter.toLowerCase());
  const { issueMap: shopifyIssueMap, summary: shopifyLookup } = await getShopifyIssueScan(channelOrders, {
    ttlMs: Number.isFinite(shopifyIssueCacheTtlMs) && shopifyIssueCacheTtlMs >= 0 ? shopifyIssueCacheTtlMs : 0
  });
  const issueConfig = {
    veeqoOrdersUrl: process.env.VEEQO_ORDERS_URL || 'https://app.veeqo.com/orders',
    veeqoOrderUrlTemplate: process.env.VEEQO_ORDER_URL_TEMPLATE || '',
    shopifyOrderUrlTemplate: process.env.SHOPIFY_ORDER_URL_TEMPLATE || ''
  };
  const orderIssues = channelOrders
    .map((order) => analyzeOrderIssues(order, {
      ...issueConfig,
      shopifyIssues: shopifyIssueMap.get(order.id)?.issues || []
    }))
    .filter(Boolean);
  const issueSummary = summarizeOrderIssues(orderIssues);
  const { heldOrderIds, batchableOrders } = splitHeldOrders(channelOrders, orderIssues);
  const { clusters, subBatches, summary } = analyzeOrders(batchableOrders, { threshold, requireGmaSkus });
  summary.source_orders = channelOrders.length;
  summary.batchable_orders = batchableOrders.length;
  summary.held_orders = heldOrderIds.size;
  summary.carrier_lookup = carrierLookup;
  summary.shopify_lookup = shopifyLookup;
  summary.issues = issueSummary;
  summary.carriers = subBatches.reduce((counts, subBatch) => {
    counts[subBatch.carrier_label] = (counts[subBatch.carrier_label] || 0) + subBatch.order_count;
    return counts;
  }, {});
  const payload = buildReportPayload({
    channelFilter,
    requireGmaSkus,
    status,
    threshold,
    orders,
    totalCount,
    totalPages,
    clusters,
    subBatches,
    summary,
    orderIssues,
    dataSource
  });
  const paths = writeReports(payload);

  return { payload, paths };
}
