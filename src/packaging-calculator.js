import { GMA_SKUS } from './constants.js';
import { getPrimaryAllocationId } from './veeqo.js';

const skuPackageGuide = {
  'PL-RW-FL30-R': '6x10 pouch',
  'PL-RW-BTS100-R': '8x10x2',
  'PL-RW-SL30-R': '6x10x2',
  'PL-RW-SB15-R': '6x10x2',
  'PL-RW-RR50-R': '6x10x2',
  'PL-RW-AA90-R': '6x10x2',
  'PL-RW-FT72-R': '6x10x2',
  'PL-RW-TRE3-R': '8x6x4 box',
  'PL-RW-TOR2-R': '8x10x2',
  'PL-RW-TGP4-R': '8x6x4 box',
  'PL-RW-TDTNR5-R': '8x6x4 box',
  'PL-RW-TFR7-R': '8x6x4 box'
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
  return /pouch|poly|mailer|envelope/i.test(String(shipper.name || ''));
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

function fitsFlexible(units = [], shipperDims) {
  const longestSide = Math.max(...units.map((unit) => unit.length));
  const widestFace = Math.max(...units.map((unit) => unit.width));
  const totalThickness = units.reduce((sum, unit) => sum + unit.height, 0);
  const requiredWidth = widestFace + totalThickness;
  const normal = longestSide <= shipperDims.length && requiredWidth <= shipperDims.width;
  const rotated = longestSide <= shipperDims.width && requiredWidth <= shipperDims.length;
  return normal || rotated;
}

function shipperVolume(shipper) {
  const dims = normalizeDims(shipper);
  return dims.length * dims.width * dims.height;
}

function itemPhysicalUnits(item) {
  const skuPieces = GMA_SKUS[item.sku]?.pieces || 1;
  return Number(item.quantity || 1) * skuPieces;
}

function totalPhysicalUnits(items = []) {
  return (items || []).reduce((sum, item) => sum + itemPhysicalUnits(item), 0);
}

function packageGuideForItems(items = []) {
  const normalizedItems = items || [];
  if (normalizedItems.length === 1 && Number(normalizedItems[0].quantity || 1) === 1) {
    const directPackage = skuPackageGuide[normalizedItems[0].sku];
    if (directPackage) return directPackage;
  }

  const units = totalPhysicalUnits(normalizedItems);
  if (units === 1) return skuPackageGuide[normalizedItems[0]?.sku] || '6x10x2';
  if (units === 2) return '8x10x2';
  if (units >= 3 && units <= 8) return '8x6x4 box';
  if (units >= 9 && units <= 12) return '10x6x6 box';
  if (units >= 13 && units <= 15) return '12x6x6 box';
  if (units >= 16) return '13x11x5 box';
  return null;
}

function findShipperByName(shippers = {}, packageName) {
  if (!packageName) return null;
  return Object.values(shippers || {}).find((shipper) => shipper.name === packageName || shipper.name?.toLowerCase() === packageName.toLowerCase());
}

function packageResult({ packageName, shipper, packed }) {
  const dims = normalizeDims(shipper);
  return {
    ok: true,
    package: packageName,
    shipper,
    packed,
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
    unit_count: units.length,
    units
  };
}

export function selectShipperForItems(items = [], settings) {
  const packed = calculatePackedDimensions(items, settings);
  if (!packed.ok) return packed;

  const guidePackage = packageGuideForItems(items);
  const guideShipper = findShipperByName(settings.shippers, guidePackage);
  if (guidePackage && guideShipper && hasDims(normalizeDims(guideShipper))) {
    return packageResult({ packageName: guidePackage, shipper: guideShipper, packed });
  }

  const candidates = Object.values(settings.shippers || {})
    .filter((shipper) => hasDims(normalizeDims(shipper)))
    .filter((shipper) => (
      isFlexibleShipper(shipper)
        ? packed.unit_count <= 2 && fitsFlexible(packed.units || [], normalizeDims(shipper))
        : fits(packed, normalizeDims(shipper))
    ))
    .sort((a, b) => shipperVolume(a) - shipperVolume(b) || String(a.name).localeCompare(String(b.name)));

  if (!candidates.length) {
    return { ok: false, reason: 'No configured shipper fits this item mix.', packed };
  }

  const shipper = candidates[0];
  return packageResult({ packageName: shipper.name, shipper, packed });
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
