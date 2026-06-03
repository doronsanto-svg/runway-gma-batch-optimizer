import { GMA_SKUS } from './constants.js';
import { getPrimaryAllocationId } from './veeqo.js';

const defaultConfig = {
  dim_divisor: 139,
  dim_weight_volume_threshold: 1728,
  max_package_weight_oz: null,
  max_realistic_fill: 0.92,
  w_billable_oz: 10,
  w_void_volume: 0.01,
  backtrack_node_cap: 20000,
  pouch_height_flex: 0.5,
  max_items_per_pouch: 2
};

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

function isFlexibleShipper(shipper = {}) {
  return shipper.kind === 'pouch' || /pouch|poly|mailer|envelope/i.test(String(shipper.name || ''));
}

function maxItemsForShipper(shipper = {}, config = defaultConfig) {
  const explicitMax = Number.parseInt(shipper.max_items, 10);
  if (Number.isFinite(explicitMax) && explicitMax > 0) return explicitMax;
  if (/^6x10\b/i.test(String(shipper.name || ''))) return 1;
  return config.max_items_per_pouch;
}

function dimensionOrientations(dims) {
  const values = Array.isArray(dims) ? dims : [dims.length, dims.width, dims.height];
  const candidates = [
    [values[0], values[1], values[2]],
    [values[0], values[2], values[1]],
    [values[1], values[0], values[2]],
    [values[1], values[2], values[0]],
    [values[2], values[0], values[1]],
    [values[2], values[1], values[0]]
  ];
  const seen = new Set();
  return candidates.filter((orientation) => {
    const key = orientation.join('x');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(([length, width, height]) => ({ length, width, height }));
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

function itemVolume(item) {
  return item.length * item.width * item.height;
}

function overlap(placed, candidate) {
  const eps = 1e-9;
  return (
    placed.x < candidate.x + candidate.l - eps &&
    candidate.x < placed.x + placed.l - eps &&
    placed.y < candidate.y + candidate.w - eps &&
    candidate.y < placed.y + placed.w - eps &&
    placed.z < candidate.z + candidate.h - eps &&
    candidate.z < placed.z + placed.h - eps
  );
}

function packItems(container, items, config = defaultConfig, { singleLayer = false } = {}) {
  const ordered = [...items].sort((a, b) => (
    Math.max(b.length, b.width, b.height) - Math.max(a.length, a.width, a.height) ||
    itemVolume(b) - itemVolume(a) ||
    String(a.sku).localeCompare(String(b.sku))
  ));
  let nodes = 0;

  function place(index, placed, points) {
    if (index === ordered.length) return placed;
    nodes += 1;
    if (nodes > config.backtrack_node_cap) return null;

    const item = ordered[index];
    const uniquePoints = [...new Map(points.map((point) => [`${point.x}|${point.y}|${point.z}`, point])).values()]
      .sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);

    for (const point of uniquePoints) {
      for (const orientation of dimensionOrientations(item)) {
        const candidate = {
          sku: item.sku,
          name: item.name,
          x: point.x,
          y: point.y,
          z: point.z,
          l: orientation.length,
          w: orientation.width,
          h: orientation.height
        };
        if (
          candidate.x + candidate.l > container.length + 1e-9 ||
          candidate.y + candidate.w > container.width + 1e-9 ||
          candidate.z + candidate.h > container.height + 1e-9
        ) {
          continue;
        }
        if (placed.some((existing) => overlap(existing, candidate))) continue;

        const nextPoints = points.filter((next) => !(next.x === point.x && next.y === point.y && next.z === point.z));
        nextPoints.push(
          { x: point.x + candidate.l, y: point.y, z: point.z },
          { x: point.x, y: point.y + candidate.w, z: point.z }
        );
        if (!singleLayer) nextPoints.push({ x: point.x, y: point.y, z: point.z + candidate.h });

        const result = place(index + 1, [...placed, candidate], nextPoints);
        if (result) return result;
      }
    }

    return null;
  }

  return place(0, [], [{ x: 0, y: 0, z: 0 }]);
}

function effectiveShipperDims(shipper, config = defaultConfig) {
  const dims = normalizeDims(shipper);
  return {
    ...dims,
    height: dims.height + (isFlexibleShipper(shipper) ? config.pouch_height_flex : 0)
  };
}

function billableWeight(shipper, itemWeightOz, config = defaultConfig) {
  const dims = normalizeDims(shipper);
  const actual = itemWeightOz + dims.weight_oz;
  const volume = dims.length * dims.width * dims.height;
  if (!config.dim_divisor || volume < config.dim_weight_volume_threshold) return actual;
  const dimOz = 16 * volume / config.dim_divisor;
  return Math.max(actual, dimOz);
}

function packageCost(plan, config = defaultConfig) {
  const voidVolume = shipperVolume(plan.shipper) - plan.placements.reduce((sum, placement) => sum + placement.l * placement.w * placement.h, 0);
  return config.w_billable_oz * plan.billable_weight_oz + config.w_void_volume * voidVolume;
}

function packageResult({ shipper, packed, placements, config = defaultConfig }) {
  const dims = normalizeDims(shipper);
  const itemWeight = packed.weight_oz;
  const billable = billableWeight(shipper, itemWeight, config);
  const itemVolumeTotal = placements.reduce((sum, placement) => sum + placement.l * placement.w * placement.h, 0);
  return {
    ok: true,
    package: shipper.name,
    shipper,
    packed,
    placements,
    fill_pct: Math.round((itemVolumeTotal / shipperVolume(shipper)) * 1000) / 10,
    total_weight_oz: Math.round((itemWeight + dims.weight_oz) * 10000) / 10000,
    billable_weight_oz: Math.round(billable * 10000) / 10000,
    allocation_package: {
      weight: Math.max(0.1, itemWeight + dims.weight_oz),
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

function tryShipper(shipper, units, packed, config = defaultConfig) {
  const dims = normalizeDims(shipper);
  if (!hasDims(dims)) return null;
  if (isFlexibleShipper(shipper) && units.length > maxItemsForShipper(shipper, config)) return null;
  if (config.max_package_weight_oz && packed.weight_oz + dims.weight_oz > config.max_package_weight_oz) return null;

  const effectiveDims = effectiveShipperDims(shipper, config);
  const itemVolumeTotal = units.reduce((sum, item) => sum + itemVolume(item), 0);
  if (itemVolumeTotal > effectiveDims.length * effectiveDims.width * effectiveDims.height * config.max_realistic_fill + 1e-9) return null;
  if (units.some((item) => !fits(item, effectiveDims))) return null;

  const placements = packItems(effectiveDims, units, config, { singleLayer: isFlexibleShipper(shipper) });
  if (!placements) return null;

  return packageResult({ shipper, packed, placements, config });
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
      units.push({
        sku: item.sku,
        name: item.name || item.sku,
        length: dims.length,
        width: dims.width,
        height: dims.height,
        weight_oz: dims.weight_oz
      });
    }
  }

  if (!units.length) return { ok: false, reason: 'No packageable items found.' };

  return {
    ok: true,
    length: Math.max(...units.map((unit) => unit.length)),
    width: Math.max(...units.map((unit) => unit.width)),
    height: units.reduce((sum, unit) => sum + unit.height, 0),
    weight_oz: units.reduce((sum, unit) => sum + unit.weight_oz, 0),
    unit_count: units.length,
    units
  };
}

export function selectShipperForItems(items = [], settings) {
  const packed = calculatePackedDimensions(items, settings);
  if (!packed.ok) return packed;

  const config = { ...defaultConfig, ...(settings.config || {}) };
  const candidates = Object.values(settings.shippers || {})
    .map((shipper) => tryShipper(shipper, packed.units || [], packed, config))
    .filter(Boolean)
    .sort((a, b) => packageCost(a, config) - packageCost(b, config) || shipperVolume(a.shipper) - shipperVolume(b.shipper) || String(a.package).localeCompare(String(b.package)));

  if (!candidates.length) {
    return { ok: false, reason: 'No configured shipper fits this item mix.', packed };
  }

  return candidates[0];
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
    ok.push({
      ...order,
      package: result.package,
      allocation_package: result.allocation_package,
      placements: result.placements,
      fill_pct: result.fill_pct,
      total_weight_oz: result.total_weight_oz,
      billable_weight_oz: result.billable_weight_oz
    });
  }
  return { ok, failed };
}
