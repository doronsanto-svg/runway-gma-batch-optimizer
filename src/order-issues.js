function clean(value) {
  return typeof value === 'string' ? value.trim() : String(value || '').trim();
}

function firstPresent(...values) {
  return values.map(clean).find(Boolean) || '';
}

function getShipTo(order) {
  return order?.deliver_to || order?.shipping_address || order?.customer?.last_used_shipping_address || {};
}

function getCustomerName(order) {
  const shipTo = getShipTo(order);
  return firstPresent(
    order?.customer?.full_name,
    `${firstPresent(shipTo.first_name)} ${firstPresent(shipTo.last_name)}`,
    `${firstPresent(order?.billing_address?.first_name)} ${firstPresent(order?.billing_address?.last_name)}`
  );
}

function getMissingAddressFields(order) {
  const shipTo = getShipTo(order);
  const required = {
    address: shipTo.address1,
    city: shipTo.city,
    state: shipTo.state,
    zip: shipTo.zip,
    country: shipTo.country
  };

  return Object.entries(required)
    .filter(([, value]) => !clean(value))
    .map(([key]) => key);
}

function getShopifyRemoteId(order) {
  return firstPresent(
    order?.remote_id,
    order?.external_id,
    order?.fulfillment_channel_order?.remote_id,
    order?.fulfillment_channel_order?.id,
    order?.sales_record_number,
    order?.number
  );
}

function applyTemplate(template, order) {
  if (!template) return '';
  return template
    .replaceAll('{order_id}', encodeURIComponent(order?.id || ''))
    .replaceAll('{order_number}', encodeURIComponent(order?.number || ''))
    .replaceAll('{order_number_raw}', order?.number || '')
    .replaceAll('{remote_id}', encodeURIComponent(getShopifyRemoteId(order)));
}

export function buildVeeqoOrderUrl(order, config = {}) {
  if (config.veeqoOrderUrlTemplate) return applyTemplate(config.veeqoOrderUrlTemplate, order);
  const base = config.veeqoOrdersUrl || 'https://app.veeqo.com/orders';
  return order?.id ? `${base.replace(/\/$/, '')}/${encodeURIComponent(order.id)}` : base;
}

export function buildShopifyOrderUrl(order, config = {}) {
  if (config.shopifyOrderUrlTemplate) return applyTemplate(config.shopifyOrderUrlTemplate, order);
  return '';
}

export function analyzeOrderIssues(order, config = {}) {
  const issues = [];
  const tags = Array.isArray(order?.tags) ? order.tags : [];
  const tagNames = tags.map((tag) => clean(tag?.name || tag)).filter(Boolean);
  const tagText = tagNames.join(' ').toLowerCase();
  const shipTo = getShipTo(order);

  const missingAddressFields = getMissingAddressFields(order);
  if (missingAddressFields.length) {
    issues.push({
      type: 'shipping',
      label: 'Shipping Address Incomplete',
      severity: 'hold',
      detail: `Missing ${missingAddressFields.join(', ')}.`
    });
  }

  if (shipTo.validated === false || shipTo.verified === false || shipTo.location_found === false || clean(shipTo.validation_message)) {
    issues.push({
      type: 'address',
      label: 'Address Verification',
      severity: shipTo.location_found === false ? 'hold' : 'warning',
      detail: clean(shipTo.validation_message) || 'Veeqo address validation is not fully verified.'
    });
  }

  if (order?.can_be_shipped === false || order?.allocated_completely === false) {
    issues.push({
      type: 'shipping',
      label: 'Shipping Hold',
      severity: 'hold',
      detail: order?.can_be_shipped === false ? 'Veeqo says this order cannot be shipped yet.' : 'Order is not fully allocated.'
    });
  }

  const riskTagNames = tagNames.filter((name) => /fraud|risk|review/i.test(name) && !/\blow\b/i.test(name));
  if (riskTagNames.length) {
    const riskText = riskTagNames.join(' ').toLowerCase();
    const highRisk = riskText.includes('high') || riskText.includes('medium') || riskText.includes('review');
    issues.push({
      type: 'fraud',
      label: highRisk ? 'Fraud Review' : 'Fraud Risk',
      severity: highRisk ? 'hold' : 'warning',
      detail: riskTagNames.join(', ') || 'Fraud or risk tag present.'
    });
  }

  if (tagText.includes('address') && (tagText.includes('hold') || tagText.includes('review') || tagText.includes('verify') || tagText.includes('invalid'))) {
    issues.push({
      type: 'address',
      label: 'Address Tag',
      severity: 'hold',
      detail: tagNames.filter((name) => /address|verify|invalid|hold/i.test(name)).join(', ')
    });
  }

  const shopifyIssues = Array.isArray(config.shopifyIssues) ? config.shopifyIssues : [];
  issues.push(...shopifyIssues);

  if (!issues.length) return null;

  return {
    order_id: order?.id,
    order_number: order?.number || String(order?.id || ''),
    customer: getCustomerName(order),
    channel: order?.channel?.name || order?.channel?.type_code || '',
    issue_types: [...new Set(issues.map((issue) => issue.type))],
    severity: issues.some((issue) => issue.severity === 'hold') ? 'hold' : 'warning',
    issues,
    tags: tagNames,
    hold: issues.some((issue) => issue.severity === 'hold'),
    veeqo_url: buildVeeqoOrderUrl(order, config),
    shopify_url: buildShopifyOrderUrl(order, config)
  };
}

export function summarizeOrderIssues(issueRecords) {
  const summary = {
    total_orders: issueRecords.length,
    hold_orders: issueRecords.filter((record) => record.severity === 'hold').length,
    warning_orders: issueRecords.filter((record) => record.severity !== 'hold').length,
    by_type: {
      phone: 0,
      address: 0,
      fraud: 0,
      shipping: 0
    }
  };

  for (const record of issueRecords) {
    for (const type of record.issue_types) {
      summary.by_type[type] = (summary.by_type[type] || 0) + 1;
    }
  }

  return summary;
}
