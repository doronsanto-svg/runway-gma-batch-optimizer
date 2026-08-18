import { DEFAULT_BORDERLINE_MIN, DEFAULT_THRESHOLD, GMA_SKUS, SEED_PACK_RATES } from './constants.js';
import { getLineItemSku, getLineItemTitle, getOrderCarrier, getOrderTotal } from './veeqo.js';
import { orderPackageInput } from './packaging-calculator.js';

export function normalizeOrderLineItems(order) {
  const quantitiesBySku = new Map();
  const titlesBySku = new Map();
  const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];

  for (const lineItem of lineItems) {
    const sku = getLineItemSku(lineItem);
    if (!sku) continue;

    const quantity = Number.parseInt(lineItem.quantity || '0', 10);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    quantitiesBySku.set(sku, (quantitiesBySku.get(sku) || 0) + quantity);
    if (!titlesBySku.has(sku)) titlesBySku.set(sku, getLineItemTitle(lineItem));
  }

  const bundleQuantity = quantitiesBySku.get('PL-RW-GAGBK3-R') || 0;
  if (bundleQuantity > 0) {
    const bundledSkus = ['PL-RW-FL30-R', 'PL-RW-SL30-R', 'PL-RW-FT72-R'];
    for (const sku of bundledSkus) {
      const remaining = (quantitiesBySku.get(sku) || 0) - bundleQuantity;
      if (remaining > 0) quantitiesBySku.set(sku, remaining);
      else quantitiesBySku.delete(sku);
    }
  }

  return [...quantitiesBySku.entries()]
    .sort(([skuA], [skuB]) => skuA.localeCompare(skuB))
    .map(([sku, quantity]) => ({
      sku,
      quantity,
      name: GMA_SKUS[sku]?.name || titlesBySku.get(sku) || sku,
      title: titlesBySku.get(sku) || null,
      pieces: GMA_SKUS[sku]?.pieces || 1,
      components: GMA_SKUS[sku]?.components || null,
      gma: Boolean(GMA_SKUS[sku])
    }));
}

export function buildSignature(items) {
  return items.map((item) => `${item.sku}:${item.quantity}`).join('|');
}

export function buildLabel(items) {
  return items.map((item) => {
    const name = GMA_SKUS[item.sku]?.name || item.title || item.sku;
    return item.quantity === 1 ? name : `${name} x ${item.quantity}`;
  }).join(' + ');
}

export function classifyItems(items) {
  if (items.length === 0) return 'unknown';
  if (items.length > 1) return 'combo';

  const [item] = items;
  const skuConfig = GMA_SKUS[item.sku];
  if (skuConfig?.type === 'kit_small') return 'kit_small';
  if (skuConfig?.type === 'kit_large') return 'kit_large';
  if (item.quantity === 1) return 'single_qty1';
  return 'single_qty2plus';
}

export function getPackagingRecommendation(category, items) {
  if (category === 'kit_large') return { station: 'B', package: '8x6x4 box' };
  if (category === 'combo') {
    const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
    return totalUnits <= 2
      ? { station: 'A or B', package: '8x12 pouch if it fits' }
      : { station: 'B', package: '8x6x4 box' };
  }
  if (category === 'single_qty1') {
    const hasAllAccess = items.some((item) => item.sku === 'PL-RW-AA90-R');
    return {
      station: 'A',
      package: hasAllAccess ? '6x10 pouch, pending All Access test fit' : '6x10 pouch'
    };
  }
  return { station: 'A', package: '8x12 pouch' };
}

export function bucketForCount(count, threshold = DEFAULT_THRESHOLD, borderlineMin = DEFAULT_BORDERLINE_MIN) {
  if (count >= threshold) return 'batch';
  if (count >= borderlineMin) return 'borderline';
  return 'multipack';
}

export function estimateMinutes(orderCount, category) {
  const rate = SEED_PACK_RATES[category] || SEED_PACK_RATES.multipack;
  return orderCount / rate;
}

function buildSubBatchId(signature, carrier) {
  return `${signature}::${carrier}`;
}

export function analyzeOrders(orders, {
  threshold = DEFAULT_THRESHOLD,
  borderlineMin = DEFAULT_BORDERLINE_MIN,
  requireGmaSkus = true
} = {}) {
  const clustersBySignature = new Map();
  const skipped = {
    no_items: 0,
    non_gma_only: 0,
    mixed_gma_and_non_gma: 0
  };

  for (const order of orders) {
    const items = normalizeOrderLineItems(order);
    if (items.length === 0) {
      skipped.no_items += 1;
      continue;
    }

    if (requireGmaSkus) {
      const gmaCount = items.filter((item) => item.gma).length;
      if (gmaCount === 0) {
        skipped.non_gma_only += 1;
        continue;
      }
      if (gmaCount !== items.length) {
        skipped.mixed_gma_and_non_gma += 1;
        continue;
      }
    }

    const signature = buildSignature(items);
    if (!clustersBySignature.has(signature)) {
      const category = classifyItems(items);
      const packaging = getPackagingRecommendation(category, items);
      clustersBySignature.set(signature, {
        signature,
        label: buildLabel(items),
        category,
        bucket: null,
        station: packaging.station,
        package: packaging.package,
        order_count: 0,
        total_revenue: 0,
        estimated_minutes: 0,
        order_ids: [],
        order_numbers: [],
        package_orders: [],
        items,
        sub_batches_by_carrier: new Map()
      });
    }

    const cluster = clustersBySignature.get(signature);
    const carrierInfo = getOrderCarrier(order);
    const revenue = getOrderTotal(order);
    cluster.order_count += 1;
    cluster.total_revenue += revenue;
    cluster.order_ids.push(order.id);
    cluster.order_numbers.push(order.number);
    cluster.package_orders.push(orderPackageInput(order, items));

    if (!cluster.sub_batches_by_carrier.has(carrierInfo.carrier)) {
      cluster.sub_batches_by_carrier.set(carrierInfo.carrier, {
        sub_batch_id: buildSubBatchId(signature, carrierInfo.carrier),
        signature,
        parent_label: cluster.label,
        label: `${cluster.label} · ${carrierInfo.carrier_label}`,
        category: cluster.category,
        carrier: carrierInfo.carrier,
        carrier_label: carrierInfo.carrier_label,
        carrier_source: carrierInfo.carrier_source,
        bucket: null,
        station: cluster.station,
        package: cluster.package,
        order_count: 0,
        total_revenue: 0,
        estimated_minutes: 0,
        order_ids: [],
        order_numbers: [],
        package_orders: [],
        items
      });
    }

    const subBatch = cluster.sub_batches_by_carrier.get(carrierInfo.carrier);
    subBatch.order_count += 1;
    subBatch.total_revenue += revenue;
    subBatch.order_ids.push(order.id);
    subBatch.order_numbers.push(order.number);
    subBatch.package_orders.push(orderPackageInput(order, items));
  }

  const clusters = [...clustersBySignature.values()]
    .map((cluster) => ({
      ...cluster,
      bucket: bucketForCount(cluster.order_count, threshold, borderlineMin),
      estimated_minutes: estimateMinutes(cluster.order_count, cluster.category),
      sub_batches: [...cluster.sub_batches_by_carrier.values()]
        .map((subBatch) => ({
          ...subBatch,
          bucket: bucketForCount(subBatch.order_count, threshold, borderlineMin),
          estimated_minutes: estimateMinutes(subBatch.order_count, subBatch.category)
        }))
        .sort((a, b) => b.order_count - a.order_count || a.carrier_label.localeCompare(b.carrier_label)),
      sub_batches_by_carrier: undefined
    }))
    .sort((a, b) => b.order_count - a.order_count || b.total_revenue - a.total_revenue);

  const subBatches = clusters
    .flatMap((cluster) => cluster.sub_batches)
    .sort((a, b) => b.order_count - a.order_count || a.label.localeCompare(b.label));

  const summary = {
    source_orders: orders.length,
    included_orders: subBatches.reduce((sum, subBatch) => sum + subBatch.order_count, 0),
    gma_orders: subBatches.reduce((sum, subBatch) => sum + subBatch.order_count, 0),
    skipped,
    total_revenue: subBatches.reduce((sum, subBatch) => sum + subBatch.total_revenue, 0),
    estimated_minutes: subBatches.reduce((sum, subBatch) => sum + subBatch.estimated_minutes, 0),
    buckets: {
      batch: subBatches.filter((subBatch) => subBatch.bucket === 'batch').length,
      borderline: subBatches.filter((subBatch) => subBatch.bucket === 'borderline').length,
      multipack: subBatches.filter((subBatch) => subBatch.bucket === 'multipack').length
    }
  };

  return { clusters, subBatches, summary };
}
