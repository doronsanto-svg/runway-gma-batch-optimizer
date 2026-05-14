export function getLineItemSku(lineItem) {
  return (
    lineItem?.sellable?.sku_code ||
    lineItem?.sellable?.sku ||
    lineItem?.sku_code ||
    lineItem?.sku ||
    null
  );
}

export function getLineItemTitle(lineItem) {
  return lineItem?.sellable?.full_title || lineItem?.title || lineItem?.name || null;
}

export function getOrderTotal(order) {
  const candidates = [
    order?.total_price,
    order?.total,
    order?.payment_total,
    order?.subtotal_price,
    order?.line_items_total
  ];

  for (const candidate of candidates) {
    const value = Number.parseFloat(candidate);
    if (Number.isFinite(value)) return value;
  }

  return 0;
}

export function getOrderChannelName(order) {
  return order?.channel?.name || order?.channel?.type_code || String(order?.channel?.id || 'Unknown channel');
}

export function getOrderCarrier(order) {
  if (order?._batch_optimizer_carrier?.carrier) {
    return order._batch_optimizer_carrier;
  }

  const raw = (
    order?.carrier?.name ||
    order?.carrier ||
    order?.shipping_carrier?.name ||
    order?.shipping_carrier ||
    order?.shipment?.carrier?.name ||
    order?.shipment?.carrier ||
    order?.delivery_method?.name ||
    order?.delivery_method ||
    ''
  );
  const text = typeof raw === 'string' ? raw.trim() : String(raw || '').trim();
  const normalized = text.toLowerCase();

  if (!text) return { carrier: 'UNKNOWN', carrier_label: 'Unknown', carrier_source: 'missing' };
  if (normalized.includes('usps') || normalized.includes('postal')) {
    return { carrier: 'USPS', carrier_label: 'USPS', carrier_source: text };
  }
  if (normalized.includes('ups')) {
    return { carrier: 'UPS', carrier_label: 'UPS', carrier_source: text };
  }
  if (normalized.includes('fedex') || normalized.includes('federal express')) {
    return { carrier: 'FEDEX', carrier_label: 'FedEx', carrier_source: text };
  }
  if (normalized.includes('dhl')) {
    return { carrier: 'DHL', carrier_label: 'DHL', carrier_source: text };
  }

  return {
    carrier: text.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'UNKNOWN',
    carrier_label: text,
    carrier_source: text
  };
}

export function getPrimaryAllocationId(order) {
  const allocations = Array.isArray(order?.allocations) ? order.allocations : [];
  return allocations[0]?.id || order?.allocation_id || null;
}

export function chooseOperationalShippingRate(rates) {
  const candidates = Array.isArray(rates) ? rates : [];
  const availableRates = candidates
    .filter((rate) => rate && rate.available !== false)
    .filter((rate) => {
      const text = [
        rate.name,
        rate.title,
        rate.service_name,
        rate.service_type,
        rate.sub_carrier_id,
        rate.service_carrier,
        rate.carrier,
        rate.carrier_name
      ].filter(Boolean).join(' ').toLowerCase();

      return !text.includes('media mail') && !text.includes('bound printed matter');
    })
    .map((rate) => ({
      rate,
      price: Number.parseFloat(
        rate.total_price ||
        rate.total_net_charge ||
        rate.total_gross_charge ||
        rate.base_rate ||
        rate.price ||
        rate.cost ||
        rate.amount ||
        '999999'
      )
    }))
    .filter(({ price }) => Number.isFinite(price))
    .sort((a, b) => a.price - b.price);

  return availableRates[0]?.rate || null;
}

export function getShippingRateCarrier(rate) {
  const raw = (
    rate?.sub_carrier_id ||
    rate?.service_carrier ||
    rate?.carrier_name ||
    rate?.carrier ||
    rate?.name ||
    rate?.title ||
    rate?.service_name ||
    ''
  );

  return getOrderCarrier({
    delivery_method: typeof raw === 'string' ? raw : String(raw || '')
  });
}

export class VeeqoClient {
  constructor({ apiKey, baseUrl = 'https://api.veeqo.com' }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async request(path, searchParams = {}, options = {}) {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text.slice(0, 500);
    }

    if (!response.ok) {
      const detail = typeof body === 'string' ? body : JSON.stringify(body);
      throw new Error(`Veeqo ${response.status} for ${url.pathname}: ${detail}`);
    }

    return { body, response };
  }

  async listOrdersPage({ status = 'awaiting_fulfillment', page = 1, pageSize = 100 }) {
    const { body, response } = await this.request('/orders', {
      status,
      page,
      page_size: pageSize
    });

    return {
      orders: Array.isArray(body) ? body : [],
      totalCount: Number.parseInt(response.headers.get('x-total-count') || '0', 10),
      totalPages: Number.parseInt(response.headers.get('x-total-pages-count') || '0', 10)
    };
  }

  async listAllOrders({ status = 'awaiting_fulfillment', pageSize = 100, maxPages = 1000 } = {}) {
    const allOrders = [];
    let totalCount = 0;
    let totalPages = 0;

    for (let page = 1; page <= maxPages; page += 1) {
      const result = await this.listOrdersPage({ status, page, pageSize });
      allOrders.push(...result.orders);
      totalCount = result.totalCount;
      totalPages = result.totalPages;

      if (result.orders.length === 0) break;
      if (totalPages && page >= totalPages) break;
    }

    return { orders: allOrders, totalCount, totalPages };
  }

  async listTags() {
    const { body } = await this.request('/tags');
    return Array.isArray(body) ? body : [];
  }

  async createTag({ name, colour = '#009aed' }) {
    const { body } = await this.request('/tags', {}, {
      method: 'POST',
      body: { name, colour }
    });
    return body;
  }

  async findOrCreateTag({ name, colour = '#009aed' }) {
    const tags = await this.listTags();
    const existing = tags.find((tag) => tag.name === name);
    if (existing) return existing;
    return this.createTag({ name, colour });
  }

  async tagOrders({ orderIds, tagIds }) {
    const { body } = await this.request('/bulk_tagging', {}, {
      method: 'POST',
      body: { order_ids: orderIds, tag_ids: tagIds }
    });
    return body;
  }

  async untagOrders({ orderIds, tagIds }) {
    const { body } = await this.request('/bulk_tagging', {}, {
      method: 'DELETE',
      body: { order_ids: orderIds, tag_ids: tagIds }
    });
    return body;
  }

  async getOrder(orderId) {
    const { body } = await this.request(`/orders/${orderId}`);
    return body;
  }

  async getShippingRates(allocationId) {
    const { body } = await this.request(`/shipping/rates/${allocationId}`, {
      from_allocation_package: 'true',
      format_with_unavailable_quotes: 'false'
    });
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.available)) return body.available;
    if (Array.isArray(body?.rates)) return body.rates;
    if (Array.isArray(body?.shipping_rates)) return body.shipping_rates;
    return [];
  }
}
