import { GMA_SKUS } from './constants.js';
import { CBS_EVENT_ID, orderMatchesEvent } from './event.js';
import { normalizeOrderLineItems } from './clusterer.js';
import { getOrderChannelName } from './veeqo.js';

function emptyProductTotals() {
  return Object.fromEntries(Object.entries(GMA_SKUS)
    .filter(([, config]) => config.type === 'single')
    .map(([sku, config]) => [sku, {
      sku,
      name: config.name,
      sold: 0,
      expanded_units: 0,
      processed: 0,
      unprocessed: 0,
      sales: null
    }]));
}

function emptyKitTotals() {
  return Object.fromEntries(Object.entries(GMA_SKUS)
    .filter(([, config]) => config.type !== 'single')
    .map(([sku, config]) => [sku, {
      sku,
      name: config.name,
      sold: 0,
      expanded_units: 0,
      processed: 0,
      unprocessed: 0,
      sales: null
    }]));
}

function addQuantity(row, quantity, processed) {
  row.sold += quantity;
  if (processed) row.processed += quantity;
  else row.unprocessed += quantity;
}

function addExpandedUnits(row, quantity) {
  row.expanded_units += quantity;
}

function addSales(row, amount) {
  if (!Number.isFinite(amount)) return;
  row.sales = Number(row.sales || 0) + amount;
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

function sortedTotals(rows, sortKey = 'sold') {
  return Object.values(rows)
    .filter((row) => row.sold > 0 || row.expanded_units > 0 || row.processed > 0 || row.unprocessed > 0)
    .sort((a, b) => Number(b[sortKey] || 0) - Number(a[sortKey] || 0) || a.name.localeCompare(b.name));
}

function total(rows, key) {
  return Object.values(rows).reduce((sum, row) => sum + Number(row[key] || 0), 0);
}

function sourceOrderNumber(order) {
  return order?.number || order?.order_number || order?.id || '';
}

function moneyValue(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function lineItemSales(lineItem, quantity) {
  const candidates = [
    lineItem?.subtotal_price,
    lineItem?.total_price,
    lineItem?.price_per_unit_including_tax && Number(lineItem.price_per_unit_including_tax) * quantity,
    lineItem?.price_per_unit && Number(lineItem.price_per_unit) * quantity,
    lineItem?.price && Number(lineItem.price) * quantity,
    lineItem?.sellable?.price && Number(lineItem.sellable.price) * quantity
  ];
  for (const candidate of candidates) {
    const value = moneyValue(candidate);
    if (value !== null) return value;
  }
  return null;
}

function lineItemSku(lineItem) {
  return lineItem?.sellable?.sku_code || lineItem?.sellable?.sku || lineItem?.sku_code || lineItem?.sku || null;
}

function lineItemsBySku(order) {
  const lines = new Map();
  for (const lineItem of Array.isArray(order?.line_items) ? order.line_items : []) {
    const sku = lineItemSku(lineItem);
    if (!sku) continue;
    const quantity = Number(lineItem.quantity || 0);
    const existing = lines.get(sku) || { quantity: 0, sales: 0, hasSales: false };
    existing.quantity += quantity;
    const sales = lineItemSales(lineItem, quantity);
    if (sales !== null) {
      existing.sales += sales;
      existing.hasSales = true;
    }
    lines.set(sku, existing);
  }
  return lines;
}

export function buildProductSalesSnapshotReport({ productSales = [], generatedAt = new Date().toISOString(), dataSource = 'Shopify product report snapshot' } = {}) {
  const products = emptyProductTotals();
  const kits = emptyKitTotals();

  for (const row of productSales || []) {
    const sku = row.sku;
    const config = GMA_SKUS[sku];
    if (!config) continue;
    const sold = Number(row.sold || 0);
    const sales = moneyValue(row.sales);

    if (config.type === 'single') {
      addQuantity(products[sku], sold, false);
      addSales(products[sku], sales);
    } else if (kits[sku]) {
      addQuantity(kits[sku], sold, false);
      addExpandedUnits(kits[sku], sold * Number(config.pieces || 1));
      addSales(kits[sku], sales);
    }

    for (const component of expandPhysicalUnits({ sku, quantity: sold })) {
      if (!products[component.sku]) continue;
      addExpandedUnits(products[component.sku], Number(component.quantity || 0));
    }
  }

  const productRows = sortedTotals(products, 'expanded_units');
  const kitRows = sortedTotals(kits, 'sold');
  const productSalesTotal = total(products, 'sales');
  const kitSalesTotal = total(kits, 'sales');

  return {
    generated_at: generatedAt,
    data_source: dataSource,
    channel_filter: 'Runway by Christian Siriano',
    orders_pulled: null,
    supports_processing: false,
    supports_sales_amount: productSales.some((row) => row.sales !== undefined && row.sales !== null),
    summary: {
      source_orders: null,
      processed_orders: null,
      unprocessed_orders: null,
      single_units_sold: total(products, 'sold'),
      single_units_expanded: total(products, 'expanded_units'),
      single_units_processed: null,
      single_units_unprocessed: null,
      kits_sold: total(kits, 'sold'),
      kit_expanded_units: total(kits, 'expanded_units'),
      kits_processed: null,
      kits_unprocessed: null,
      product_sales: productSalesTotal || null,
      kit_sales: kitSalesTotal || null,
      total_sales: productSalesTotal || kitSalesTotal ? productSalesTotal + kitSalesTotal : null,
      skipped_no_gma: 0,
      skipped_no_items: 0
    },
    products: productRows,
    kits: kitRows,
    top_single_units: productRows.slice(0, 10),
    top_kits: kitRows.slice(0, 10)
  };
}

export function buildSalesReport({ orders = [], eventId = null, channelFilter = '', completedOrderIds = new Set(), generatedAt = new Date().toISOString(), dataSource = 'Veeqo order history', totalCount = null, totalPages = null, pagesPulled = null } = {}) {
  const products = emptyProductTotals();
  const kits = emptyKitTotals();
  const channelNeedle = String(channelFilter || '').trim().toLowerCase();
  const completedIds = new Set([...completedOrderIds].map((id) => String(id)));
  const sourceOrders = [];
  let skippedNoGma = 0;
  let skippedNoItems = 0;

  for (const order of orders || []) {
    const channelName = getOrderChannelName(order);
    if (eventId === CBS_EVENT_ID) {
      if (!orderMatchesEvent(order, eventId)) continue;
    } else if (channelNeedle && String(channelName || '').trim().toLowerCase() !== channelNeedle) continue;

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
      const line = lineItemsBySku(order).get(item.sku);
      const sales = line?.hasSales ? line.sales : null;

      if (config.type !== 'single' && kits[item.sku]) {
        addQuantity(kits[item.sku], quantity, processed);
        addExpandedUnits(kits[item.sku], quantity * Number(config.pieces || 1));
        addSales(kits[item.sku], sales);
      }

      for (const component of expandPhysicalUnits(item)) {
        if (!products[component.sku]) continue;
        addQuantity(products[component.sku], Number(component.quantity || 0), processed);
        addExpandedUnits(products[component.sku], Number(component.quantity || 0));
      }

      if (config.type === 'single' && products[item.sku]) addSales(products[item.sku], sales);
    }
  }

  const productRows = sortedTotals(products, 'expanded_units');
  const kitRows = sortedTotals(kits, 'sold');
  const processedOrders = sourceOrders.filter((order) => order.processed).length;
  const unprocessedOrders = sourceOrders.length - processedOrders;

  return {
    event_id: eventId,
    event_label: eventId === CBS_EVENT_ID ? 'CBS Deals' : 'GMA Legacy',
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
      kit_expanded_units: total(kits, 'expanded_units'),
      kits_processed: total(kits, 'processed'),
      kits_unprocessed: total(kits, 'unprocessed'),
      product_sales: total(products, 'sales') || null,
      kit_sales: total(kits, 'sales') || null,
      total_sales: (total(products, 'sales') || total(kits, 'sales')) ? total(products, 'sales') + total(kits, 'sales') : null,
      skipped_no_gma: skippedNoGma,
      skipped_no_items: skippedNoItems
    },
    products: productRows,
    kits: kitRows,
    top_single_units: productRows.slice(0, 10),
    top_kits: kitRows.slice(0, 10)
  };
}
