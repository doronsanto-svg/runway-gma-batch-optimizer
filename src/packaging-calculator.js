import { GMA_SKUS } from './constants.js';
import { getPrimaryAllocationId } from './veeqo.js';

function number(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDims(record = {}) {
  return {
    length: number(record.length),
    width: number(record.width),
    height: number(record.height),
    weight_oz: number(record.weight_oz)
  };
}

function hasDims(dims) {
  return dims.length > 0 && dims.width > 0 && dims.height > 0;
}

function dimensionOrientations(dims) {
  const values = [dims.length, dims.width, dims.height];
  return [
    [values[0], values[1], values[2]],
    [values[0], values[2], values[1]],
    [values[1], values[0], values[2]],
    [values[1], values[2], values[0]],
    [values[2], values[0], values[1]],
    [values[2], values[1], values[0]]
  ].map(([length, width, height]) => ({ length, width, height }));
}

function fits(packageDims, shipperDims) {
  return dimensionOrientations(packageDims).some((orientation) => (
    orientation.length <= shipperDims.length
    && orientation.width <= shipperDims.width
    && orientation.height <= shipperDims.height
  ));
}

function shipperVolume(shipper) {
  const dims = normalizeDims(shipper);
  return dims.length * dims.width * dims.height;
}

export function expandItemsToSingles(items = []) {
  const singles = [];
  for (const item of items || []) {
    const quantity = Number(item.quantity || 1);
    const components = Array.isArray(item.components) && item.components.length
      ? item.components
      : GMA_SKUS[item.sku]?.components;
    if (Array.isArray(components) && components.length) {
      components.forEach((component) => {
        singles.push({
          sku: component.sku || Object.entries(GMA_SKUS).find(([, config]) => config.name === component.name)?.[0] || component.name,
          name: component.name,
          quantity: quantity * Number(component.quantity || 1)
        });
      });
      continue;
    }
    singles.push({
      sku: item.sku,
      name: item.name || item.title || GMA_SKUS[item.sku]?.name || item.sku,
      quantity
    });
  }
  return singles;
}

export function calculatePackedDimensions(items = [], settings) {
  const expanded = expandItemsToSingles(items);
  const units = [];
  for (const item of expanded) {
    const product = settings.products?.[item.sku];
    const dims = normalizeDims(product);
    if (!product || !hasDims(dims)) {
      return { ok: false, reason: `Missing dimensions for ${item.name || item.sku}.` };
    }
    for (let index = 0; index < Number(item.quantity || 1); index += 1) {
      const sorted = [dims.length, dims.width, dims.height].sort((a, b) => b - a);
      units.push({ length: sorted[0], width: sorted[1], height: sorted[2], weight_oz: dims.weight_oz });
    }
  }

  if (!units.length) return { ok: false, reason: 'No packageable items found.' };

  return {
    ok: true,
    length: Math.max(...units.map((unit) => unit.length)),
    width: Math.max(...units.map((unit) => unit.width)),
    height: units.reduce((sum, unit) => sum + unit.height, 0),
    weight_oz: units.reduce((sum, unit) => sum + unit.weight_oz, 0),
    unit_count: units.length
  };
}

export function selectShipperForItems(items = [], settings) {
  const packed = calculatePackedDimensions(items, settings);
  if (!packed.ok) return packed;

  const candidates = Object.values(settings.shippers || {})
    .filter((shipper) => hasDims(normalizeDims(shipper)))
    .filter((shipper) => fits(packed, normalizeDims(shipper)))
    .sort((a, b) => shipperVolume(a) - shipperVolume(b) || String(a.name).localeCompare(String(b.name)));

  if (!candidates.length) {
    return { ok: false, reason: 'No configured shipper fits this item mix.', packed };
  }

  const shipper = candidates[0];
  const dims = normalizeDims(shipper);
  return {
    ok: true,
    package: shipper.name,
    shipper,
    allocation_package: {
      weight: Math.max(0.1, packed.weight_oz + dims.weight_oz),
      weight_unit: 'oz',
      width: dims.width,
      height: dims.height,
      depth: dims.length,
      dimensions_unit: 'inches',
      package_provider: 'CUSTOM',
      package_selection_source: 'ONE_OFF',
      save_for_similar_shipments: false
    }
  };
}

export function orderPackageInput(order, items) {
  return {
    order_id: order.id,
    order_number: order.number,
    allocation_id: getPrimaryAllocationId(order),
    items
  };
}

export function packageOrdersForBatch(packageOrders = [], settings) {
  const ok = [];
  const failed = [];
  for (const order of packageOrders || []) {
    const result = selectShipperForItems(order.items || [], settings);
    if (!order.allocation_id) {
      failed.push({ ...order, reason: 'Missing Veeqo allocation ID.' });
      continue;
    }
    if (!result.ok) {
      failed.push({ ...order, reason: result.reason });
      continue;
    }
    ok.push({ ...order, package: result.package, allocation_package: result.allocation_package });
  }
  return { ok, failed };
}
