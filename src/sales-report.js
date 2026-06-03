import { GMA_SKUS } from './constants.js';
import { normalizeOrderLineItems } from './clusterer.js';
import { getOrderChannelName } from './veeqo.js';

function emptyProductTotals() {
  return Object.fromEntries(Object.entries(GMA_SKUS)
    .filter(([, config]) => config.type === 'single')
    .map(([sku, config]) => [sku, {
      sku,
      name: config.name,
      sold: 0,
      processed: 0,
      unprocessed: 0
    }]));
}

function emptyKitTotals() {
  return Object.fromEntries(Object.entries(GMA_SKUS)
    .filter(([, config]) => config.type !== 'single')
    .map(([sku, config]) => [sku, {
      sku,
      name: config.name,
      sold: 0,
      processed: 0,
      unprocessed: 0
    }]));
}

function addQuantity(row, quantity, processed) {
  row.sold += quantity;
  if (processed) row.processed += quantity;
  else row.unprocessed += quantity;
}

function componentSku(component = {}) {
  if (component.sku) return component.sku;
  return Object.entries(GMA_SKUS).find(([, config]) => config.name === component.name)?.[0] || null;
}

function expandPhysicalUnits(item) {
  const config = GMA_SKUS[item.sku];
  const quantity = Number(item.quantity || 0);
  if (!config?.components?.length) {
    return [{ sku: item.sku, quantity }];
  }

  return config.components
    .map((component) => ({
      sku: componentSku(component),
      quantity: quantity * Number(component.quantity || 1)
    }))
    .filter((component) => component.sku);
}

function sortedTotals(rows) {
  return Object.values(rows)
    .filter((row) => row.sold > 0 || row.processed > 0 || row.unprocessed > 0)
    .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name));
}

function total(rows, key) {
  return Object.values(rows).reduce((sum, row) => sum + Number(row[key] || 0), 0);
}

function sourceOrderNumber(order) {
  return order?.number || order?.order_number || order?.id || '';
}

export function buildSalesReport({ orders = [], channelFilter = '', completedOrderIds = new Set(), generatedAt = new Date().toISOString(), dataSource = 'Veeqo order history', totalCount = null, totalPages = null, pagesPulled = null } = {}) {
  const products = emptyProductTotals();
  const kits = emptyKitTotals();
  const channelNeedle = String(channelFilter || '').trim().toLowerCase();
  const completedIds = new Set([...completedOrderIds].map((id) => String(id)));
  const sourceOrders = [];
  let skippedNoGma = 0;
  let skippedNoItems = 0;

  for (const order of orders || []) {
    const channelName = getOrderChannelName(order);
    if (channelNeedle && String(channelName || '').trim().toLowerCase() !== channelNeedle) continue;

    const items = normalizeOrderLineItems(order).filter((item) => item.gma);
    if (!items.length) {
      const allItems = normalizeOrderLineItems(order);
      if (allItems.length) skippedNoGma += 1;
      else skippedNoItems += 1;
      continue;
    }

    const processed = completedIds.has(String(order.id));
    sourceOrders.push({
      id: order.id,
      number: sourceOrderNumber(order),
      processed,
      channel: channelName
    });

    for (const item of items) {
      const config = GMA_SKUS[item.sku];
      if (!config) continue;
      const quantity = Number(item.quantity || 0);

      if (config.type !== 'single' && kits[item.sku]) {
        addQuantity(kits[item.sku], quantity, processed);
      }

      for (const component of expandPhysicalUnits(item)) {
        if (!products[component.sku]) continue;
        addQuantity(products[component.sku], Number(component.quantity || 0), processed);
      }
    }
  }

  const productRows = sortedTotals(products);
  const kitRows = sortedTotals(kits);
  const processedOrders = sourceOrders.filter((order) => order.processed).length;
  const unprocessedOrders = sourceOrders.length - processedOrders;

  return {
    generated_at: generatedAt,
    data_source: dataSource,
    channel_filter: channelFilter,
    orders_pulled: orders.length,
    veeqo_total_count: totalCount,
    veeqo_total_pages: totalPages,
    pages_pulled: pagesPulled,
    summary: {
      source_orders: sourceOrders.length,
      processed_orders: processedOrders,
      unprocessed_orders: unprocessedOrders,
      single_units_sold: total(products, 'sold'),
      single_units_processed: total(products, 'processed'),
      single_units_unprocessed: total(products, 'unprocessed'),
      kits_sold: total(kits, 'sold'),
      kits_processed: total(kits, 'processed'),
      kits_unprocessed: total(kits, 'unprocessed'),
      skipped_no_gma: skippedNoGma,
      skipped_no_items: skippedNoItems
    },
    products: productRows,
    kits: kitRows,
    top_single_units: productRows.slice(0, 10),
    top_kits: kitRows.slice(0, 10)
  };
}
