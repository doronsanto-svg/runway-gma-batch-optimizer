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
import { buildPrepRows, packageOptions, packageSuggestionForRow, prepSummary, readPrepStore } from './prep-store.js';
import { readBatchStore } from './batch-store.js';

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

export function orderHasPurchasedLabel(order) {
  const allocations = Array.isArray(order?.allocations) ? order.allocations : [];
  return Boolean(
    order?.shipped_at ||
    order?.shipment ||
    (Array.isArray(order?.shipments) && order.shipments.length > 0) ||
    order?.tracking_number ||
    (Array.isArray(order?.tracking_numbers) && order.tracking_numbers.length > 0) ||
    allocations.some((allocation) => (
      allocation?.shipment ||
      (Array.isArray(allocation?.shipments) && allocation.shipments.length > 0) ||
      allocation?.tracking_number ||
      (Array.isArray(allocation?.tracking_numbers) && allocation.tracking_numbers.length > 0)
    ))
  );
}

export function completedOrderIdsForAnalysis(store = readBatchStore()) {
  return new Set((store.completed || [])
    .filter((batch) => batch.mode !== 'demo')
    .flatMap((batch) => batch.order_ids || []));
}

export function applyPackageOverrides(clusters, store) {
  return (clusters || []).map((cluster) => {
    const suggestion = packageSuggestionForRow(cluster, store);
    const packageName = suggestion.packageName;
    const applyOverride = (row) => ({
      ...row,
      package: packageName,
      default_package: row.package,
      package_overridden: suggestion.source === 'exact',
      package_suggestion_source: suggestion.source,
      package_options: packageOptions()
    });

    return applyOverride({
      ...cluster,
      sub_batches: (cluster.sub_batches || []).map(applyOverride)
    });
  });
}

export function applyPackageStateToReport(report, store = readPrepStore()) {
  if (!report || report.empty) return report;
  const clusters = applyPackageOverrides(report.clusters || [], store);
  const actionableBatches = applyPackageOverrides(report.actionable_batches || report.clusters || [], store);
  const prepRows = buildPrepRows(report.clusters || [], store);

  return {
    ...report,
    clusters,
    actionable_batches: actionableBatches,
    prep_rows: prepRows,
    summary: {
      ...(report.summary || {}),
      prep: prepSummary(prepRows)
    }
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
  const issueConfig = {
    veeqoOrdersUrl: process.env.VEEQO_ORDERS_URL || 'https://app.veeqo.com/orders',
    veeqoOrderUrlTemplate: process.env.VEEQO_ORDER_URL_TEMPLATE || '',
    shopifyOrderUrlTemplate: process.env.SHOPIFY_ORDER_URL_TEMPLATE || ''
  };
  const orderIssues = channelOrders
    .map((order) => analyzeOrderIssues(order, issueConfig))
    .filter(Boolean);
  const issueSummary = summarizeOrderIssues(orderIssues);
  const { heldOrderIds, batchableOrders } = splitHeldOrders(channelOrders, orderIssues);
  const completedOrderIds = completedOrderIdsForAnalysis();
  const locallyCompletedOrders = batchableOrders.filter((order) => completedOrderIds.has(order.id));
  const openBatchableOrders = batchableOrders.filter((order) => !completedOrderIds.has(order.id));
  const labelPurchasedOrders = openBatchableOrders.filter(orderHasPurchasedLabel);
  const labelNeededOrders = openBatchableOrders.filter((order) => !orderHasPurchasedLabel(order));
  const rawAnalysis = analyzeOrders(labelNeededOrders, { threshold, requireGmaSkus });
  const prepStore = readPrepStore();
  const clusters = applyPackageOverrides(rawAnalysis.clusters, prepStore);
  const subBatches = clusters.flatMap((cluster) => cluster.sub_batches || []);
  const summary = rawAnalysis.summary;
  const prepRows = buildPrepRows(rawAnalysis.clusters, prepStore);
  summary.source_orders = channelOrders.length;
  summary.batchable_orders = batchableOrders.length;
  summary.local_completed_orders = locallyCompletedOrders.length;
  summary.open_batchable_orders = openBatchableOrders.length;
  summary.label_needed_orders = labelNeededOrders.length;
  summary.label_purchased_orders = labelPurchasedOrders.length;
  summary.held_orders = heldOrderIds.size;
  summary.carrier_lookup = carrierLookup;
  summary.issues = issueSummary;
  summary.carriers = subBatches.reduce((counts, subBatch) => {
    counts[subBatch.carrier_label] = (counts[subBatch.carrier_label] || 0) + subBatch.order_count;
    return counts;
  }, {});
  summary.prep = prepSummary(prepRows);
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
    prepRows,
    dataSource
  });
  const paths = writeReports(payload);

  return { payload, paths };
}
