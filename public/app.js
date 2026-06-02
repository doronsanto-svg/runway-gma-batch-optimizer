const summaryGrid = document.querySelector('#summaryGrid');
const refreshButton = document.querySelector('#refreshButton');
const carrierRefreshButton = document.querySelector('#carrierRefreshButton');
const demoButton = document.querySelector('#demoButton');
const logoutButton = document.querySelector('#logoutButton');
const teamSizeInput = document.querySelector('#teamSizeInput');
const stationCountInput = document.querySelector('#stationCountInput');
const channelInput = document.querySelector('#channelInput');
const channelOptions = document.querySelector('#channelOptions');
const channelScanButton = document.querySelector('#channelScanButton');
const teamForecast = document.querySelector('#teamForecast');
const chartBars = document.querySelector('#chartBars');
const activeBatches = document.querySelector('#activeBatches');
const activeBatchCount = document.querySelector('#activeBatchCount');
const completedBatches = document.querySelector('#completedBatches');
const completedBatchCount = document.querySelector('#completedBatchCount');
const prepSummaryGrid = document.querySelector('#prepSummaryGrid');
const prepTable = document.querySelector('#prepTable');
const prepTableCount = document.querySelector('#prepTableCount');
const printPrepButton = document.querySelector('#printPrepButton');
const issueSummaryGrid = document.querySelector('#issueSummaryGrid');
const issueTable = document.querySelector('#issueTable');
const issueTableCount = document.querySelector('#issueTableCount');
const historySummaryGrid = document.querySelector('#historySummaryGrid');
const historyTable = document.querySelector('#historyTable');
const historyTableCount = document.querySelector('#historyTableCount');
const toast = document.querySelector('#statusToast');
const quickBatchActions = document.querySelector('#quickBatchActions');

let currentReport = null;
let batchState = { active: [], completed: [] };
let prepState = { rows: [], summary: {} };
let selectedPrepKeys = new Set();
let portalConfig = {
  veeqo_orders_url: 'https://app.veeqo.com/orders',
  veeqo_tag_filter_url_template: ''
};
const collapseStorageKey = 'fillement_collapsed_sections';
const kitPiecesByPrintLabel = {
  'overnight recovery kit': 2,
  'runway essentials kit': 3,
  'glow protocol kit': 4,
  'day-to-night kit': 5,
  'full runway kit': 7
};
const prepMatrixColumns = [
  { key: 'access', header: 'ACCESS', labels: ['all access'] },
  { key: 'stage', header: 'STAGE', labels: ['stage bright'] },
  { key: 'spotlight', header: 'SPOTLIGHT', labels: ['spotlight'] },
  { key: 'behind', header: 'BEHIND', labels: ['behind the scenes'] },
  { key: 'finishing', header: 'FINISHING', labels: ['finishing touch'] },
  { key: 'radiance', header: 'RADIANCE', labels: ['radiance ready'] },
  { key: 'first_look', header: 'FIRST LOOK', labels: ['first look'] }
];
const prepMatrixColumnByLabel = prepMatrixColumns.reduce((lookup, column) => {
  column.labels.forEach((label) => lookup.set(label, column.key));
  return lookup;
}, new Map());

const sections = {
  batch: {
    count: document.querySelector('#batchCount'),
    list: document.querySelector('#batchClusters')
  },
  borderline: {
    count: document.querySelector('#borderlineCount'),
    list: document.querySelector('#borderlineClusters')
  },
  multipack: {
    count: document.querySelector('#multipackCount'),
    list: document.querySelector('#multipackClusters')
  }
};

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function minutes(value) {
  if (value < 1) return '<1 min';
  if (value < 60) return `${Math.round(value)} min`;

  const hours = Math.floor(value / 60);
  const mins = Math.round(value % 60);
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function secondsSince(value) {
  if (!value) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
}

function activeElapsedSeconds(batch) {
  const totalSeconds = secondsSince(batch.started_at);
  const pauseSeconds = Number(batch.pause_seconds || 0);
  const currentPauseSeconds = batch.status === 'paused' && batch.paused_at ? secondsSince(batch.paused_at) : 0;
  return Math.max(0, totalSeconds - pauseSeconds - currentPauseSeconds);
}

function setButtonProcessing(button, active, label = 'Processing...') {
  if (!button) return;
  if (active) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.classList.add('is-processing');
    button.textContent = label;
    return;
  }
  button.disabled = false;
  button.classList.remove('is-processing');
  if (button.dataset.originalText) button.textContent = button.dataset.originalText;
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  input.remove();
}

function veeqoUrlForTag(tagName, tagId = '') {
  const template = portalConfig.veeqo_tag_filter_url_template || '';
  if (template && tagId) {
    return template
      .replaceAll('{tag_id}', encodeURIComponent(tagId))
      .replaceAll('{tag}', encodeURIComponent(tagName))
      .replaceAll('{tag_raw}', tagName);
  }
  return portalConfig.veeqo_orders_url || 'https://app.veeqo.com/orders';
}

async function handleAuthResponse(response) {
  if (response.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new Error('Login required.');
  }
  return response;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function itemKey(item) {
  return item?.sku || item?.name || item?.title || '';
}

function itemLabel(item) {
  return item?.name || item?.title || item?.sku || 'Item';
}

function itemComponents(item) {
  const components = Array.isArray(item?.components) ? item.components : [];
  if (components.length) {
    return components.map((component) => ({
      label: component.name || component.title || component.sku || 'Item',
      quantity: Number(component.quantity || 1)
    }));
  }

  return [{
    label: itemLabel(item),
    quantity: Number(item?.pieces || 1)
  }];
}

function prepItemLabels(row) {
  return (row?.items || [])
    .slice()
    .sort((a, b) => itemLabel(a).localeCompare(itemLabel(b)))
    .map(itemLabel);
}

function prepOverlapScore(rowA, rowB) {
  const keysA = new Set((rowA?.items || []).map(itemKey).filter(Boolean));
  const keysB = new Set((rowB?.items || []).map(itemKey).filter(Boolean));
  return [...keysA].filter((key) => keysB.has(key)).length;
}

function sortPrepRowsBySharedItems(rows) {
  const openRows = rows.filter((row) => !row.prepared);
  const preparedRows = rows.filter((row) => row.prepared);
  const sorted = [];
  const remaining = [...openRows].sort((a, b) => b.order_count - a.order_count || a.label.localeCompare(b.label));
  while (remaining.length) {
    const current = sorted.length
      ? remaining
        .map((row, index) => ({ row, index, score: prepOverlapScore(sorted[sorted.length - 1], row) }))
        .sort((a, b) => b.score - a.score || b.row.order_count - a.row.order_count || a.row.label.localeCompare(b.row.label))[0]
      : { row: remaining[0], index: 0 };
    sorted.push(current.row);
    remaining.splice(current.index, 1);
  }
  return [...sorted, ...preparedRows.sort((a, b) => b.order_count - a.order_count || a.label.localeCompare(b.label))];
}

function stagingTotalsForPrepRows(rows) {
  const totals = new Map();
  rows.forEach((row) => {
    const orderCount = Number(row.order_count || 0);
    (row.items || []).forEach((item) => {
      const label = itemLabel(item);
      const quantity = Number(item.quantity || 1);
      const pieces = Number(item.pieces || 1);
      totals.set(label, (totals.get(label) || 0) + (orderCount * quantity * pieces));
    });
  });
  return [...totals.entries()]
    .map(([label, quantity]) => ({ label, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label));
}

function kitStagingRowsForPrepRows(rows) {
  const staged = new Map();
  rows.forEach((row) => {
    const orderCount = Number(row.order_count || 0);
    (row.items || []).forEach((item) => {
      const label = itemLabel(item);
      const quantity = Number(item.quantity || 1);
      const pieces = Number(item.pieces || 1);
      const sets = orderCount * quantity;
      const key = itemKey(item) || label;
      const existing = staged.get(key) || {
        key,
        label,
        set_count: 0,
        pieces_per_set: pieces,
        total_items: 0,
        source_rows: 0,
        components: new Map()
      };
      existing.set_count += sets;
      existing.total_items += sets * pieces;
      existing.source_rows += 1;
      existing.pieces_per_set = Math.max(existing.pieces_per_set, pieces);
      itemComponents(item).forEach((component) => {
        existing.components.set(
          component.label,
          (existing.components.get(component.label) || 0) + (sets * component.quantity)
        );
      });
      staged.set(key, existing);
    });
  });

  return [...staged.values()]
    .map((row) => ({
      ...row,
      component_totals: [...row.components.entries()]
        .map(([label, quantity]) => ({ label, quantity }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      components: undefined
    }))
    .sort((a, b) => b.set_count - a.set_count || a.label.localeCompare(b.label));
}

function prepMatrixQuantityForItem(item, orderCount) {
  const itemQuantity = Number(item?.quantity || 1);
  const components = Array.isArray(item?.components) ? item.components : [];
  if (components.length) {
    return components.map((component) => ({
      label: component.name || component.title || component.sku || 'Item',
      quantity: orderCount * itemQuantity * Number(component.quantity || 1)
    }));
  }

  return [{
    label: itemLabel(item),
    quantity: orderCount * itemQuantity * Number(item?.pieces || 1)
  }];
}

function prepMatrixRows(rows) {
  return rows.map((row) => {
    const quantities = Object.fromEntries(prepMatrixColumns.map((column) => [column.key, 0]));
    const orderCount = Number(row.order_count || 0);

    (row.items || []).forEach((item) => {
      prepMatrixQuantityForItem(item, orderCount).forEach((entry) => {
        const key = prepMatrixColumnByLabel.get(String(entry.label || '').trim().toLowerCase());
        if (!key) return;
        quantities[key] += Number(entry.quantity || 0);
      });
    });

    return { row, quantities };
  });
}

function prepKitSummary(row) {
  return (row.items || [])
    .map((item) => {
      const label = itemLabel(item);
      const quantity = Number(item.quantity || 1);
      const pieces = Number(item.pieces || 1);
      const setLabel = quantity > 1 ? `${label} x ${quantity}` : label;
      const totalItems = quantity * pieces;
      const components = itemComponents(item).map((component) => `${component.label} x${component.quantity * quantity}`).join(', ');
      const detail = totalItems > quantity ? `${totalItems} items: ${components}` : `${quantity} item${quantity === 1 ? '' : 's'}`;
      return `${setLabel}: ${detail}`;
    })
    .join('; ');
}

function batchItemsForPrint(batch) {
  const items = Array.isArray(batch.items) ? batch.items : [];
  if (items.length) {
    return items.map((item) => {
      const name = item.name || item.title || item.sku || 'Item';
      const quantity = Number(item.quantity || 1);
      const pieces = Number(item.pieces || 1);
      return {
        label: quantity > 1 ? `${name} x ${quantity}` : name,
        quantity,
        pieces
      };
    });
  }

  const carrierSuffix = batch.carrier_label ? ` · ${batch.carrier_label}` : '';
  const label = carrierSuffix && batch.label?.endsWith(carrierSuffix)
    ? batch.label.slice(0, -carrierSuffix.length)
    : batch.label || 'Batch';
  return label
    .split(' + ')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => ({
      label: item,
      quantity: 1,
      pieces: kitPiecesByPrintLabel[item.toLowerCase()] || 1
    }));
}

function batchItemsPerSet(batch) {
  return batchItemsForPrint(batch).reduce((sum, item) => sum + (Number(item.quantity || 1) * Number(item.pieces || 1)), 0);
}

function carrierPrintMarkup(selectedCarrier) {
  if (selectedCarrier === 'USPS' || selectedCarrier === 'UPS') {
    return `<div class="carrier-check carrier-single"><div class="carrier-box">${selectedCarrier}</div></div>`;
  }

  return `
    <div class="carrier-check">
      <div class="carrier-box">USPS</div>
      <div class="carrier-box">UPS</div>
    </div>
  `;
}

function printBatchLabel(batchId) {
  const batch = [...(batchState.active || []), ...(batchState.completed || [])].find((item) => item.id === batchId);
  if (!batch) {
    showToast('Batch not found.');
    return;
  }

  const items = batchItemsForPrint(batch);
  const setCount = Number(batch.order_count || 0);
  const itemsPerSet = batchItemsPerSet(batch);
  const totalItems = setCount * itemsPerSet;
  const selectedCarrier = batch.print_carrier || '';
  const content = `
    <!doctype html>
    <html>
      <head>
        <title>Batch Label</title>
        <style>
          @page { margin: 0; size: 4in 6in; }
          * { box-sizing: border-box; }
          body {
            color: #111827;
            font-family: Arial, Helvetica, sans-serif;
            margin: 0;
          }
          .label {
            align-content: start;
            display: grid;
            gap: 0.14in;
            height: 6in;
            padding: 0.28in;
            width: 4in;
          }
          .count {
            font-size: 0.72in;
            font-weight: 900;
            line-height: 0.95;
          }
          .total {
            border-bottom: 2px solid #111827;
            font-size: 0.26in;
            font-weight: 900;
            line-height: 1.1;
            padding-bottom: 0.12in;
          }
          .carrier-check {
            display: grid;
            gap: 0.12in;
            grid-template-columns: 1fr 1fr;
          }
          .carrier-box {
            border: 3px solid #111827;
            font-size: 0.42in;
            font-weight: 900;
            line-height: 1;
            padding: 0.12in 0.04in;
            text-align: center;
          }
          .carrier-single {
            grid-template-columns: 1fr;
          }
          .carrier-single .carrier-box {
            font-size: 0.72in;
            padding: 0.16in 0.04in;
          }
          .package {
            border: 3px solid #111827;
            font-size: 0.32in;
            font-weight: 900;
            line-height: 1.05;
            padding: 0.1in;
            text-align: center;
            text-transform: uppercase;
          }
          .items {
            display: grid;
            gap: 0.12in;
            font-size: 0.3in;
            font-weight: 800;
            line-height: 1.08;
          }
        </style>
      </head>
      <body>
        <section class="label">
          <div class="count">${setCount} sets</div>
          <div class="total">${itemsPerSet} items per set · ${totalItems} total items</div>
          ${carrierPrintMarkup(selectedCarrier)}
          <div class="package">${escapeHtml(batch.package || 'Package')}</div>
          <div class="items">
            ${items.map((item) => `<div>${escapeHtml(item.label)}</div>`).join('')}
          </div>
        </section>
      </body>
    </html>
  `;
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('Print window blocked.');
    return;
  }
  printWindow.document.write(content);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function readCollapsedSections() {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(collapseStorageKey) || '[]'));
  } catch {
    return new Set();
  }
}

function writeCollapsedSections(collapsed) {
  window.localStorage.setItem(collapseStorageKey, JSON.stringify([...collapsed]));
}

function applyCollapsedSections() {
  const collapsed = readCollapsedSections();
  document.querySelectorAll('.collapsible-section').forEach((section) => {
    const key = section.dataset.collapseKey;
    const isCollapsed = collapsed.has(key);
    section.classList.toggle('is-collapsed', isCollapsed);
    section.querySelector('.collapse-toggle')?.setAttribute('aria-expanded', String(!isCollapsed));
  });
}

function toggleCollapsedSection(section) {
  const key = section.dataset.collapseKey;
  if (!key) return;
  const collapsed = readCollapsedSections();
  if (collapsed.has(key)) collapsed.delete(key);
  else collapsed.add(key);
  writeCollapsedSections(collapsed);
  applyCollapsedSections();
}

function packageControl(row, mode = 'prep') {
  const options = [...new Set([...(row.package_options || []), row.package].filter(Boolean))];
  const selectOptions = options.map((option) => `<option value="${escapeHtml(option)}"${option === row.package ? ' selected' : ''}>${escapeHtml(option)}</option>`).join('');
  const customValue = row.package_options?.includes(row.package) ? '' : row.package;
  const suggestionLabels = {
    exact: 'Saved choice',
    signature_memory: 'Saved choice',
    similar_memory: 'Learned suggestion',
    category_memory: 'Category suggestion',
    default: 'Recommended'
  };
  const suggestionLabel = suggestionLabels[row.package_suggestion_source] || (row.package_overridden ? 'Saved choice' : 'Recommended');
  return `
    <div class="package-control">
      <select class="${mode}-package-select" data-signature="${escapeHtml(row.signature)}" data-label="${escapeHtml(row.label)}" data-category="${escapeHtml(row.category || '')}" data-items="${escapeHtml(JSON.stringify(row.items || []))}">
        ${selectOptions}
        <option value="__custom__"${customValue ? ' selected' : ''}>Custom</option>
      </select>
      <input class="${mode}-package-custom" data-signature="${escapeHtml(row.signature)}" data-label="${escapeHtml(row.label)}" data-category="${escapeHtml(row.category || '')}" data-items="${escapeHtml(JSON.stringify(row.items || []))}" value="${escapeHtml(customValue)}" placeholder="Custom package"${customValue ? '' : ' hidden'}>
      <small>${escapeHtml(suggestionLabel)}</small>
    </div>
  `;
}

function labelCarrierControl(batch) {
  const selected = batch.print_carrier || '';
  return `
    <select class="label-carrier-select" data-batch-id="${escapeHtml(batch.id)}">
      <option value=""${selected ? '' : ' selected'}>Show USPS + UPS</option>
      <option value="USPS"${selected === 'USPS' ? ' selected' : ''}>Print USPS only</option>
      <option value="UPS"${selected === 'UPS' ? ' selected' : ''}>Print UPS only</option>
    </select>
  `;
}

function activeBatchForSubBatch(subBatchId) {
  return (batchState.active || []).find((batch) => batch.sub_batch_id === subBatchId);
}

function completedOrderIdsInState() {
  return new Set((batchState.completed || []).flatMap((batch) => batch.order_ids || []));
}

function isClusterFullyCompleted(cluster) {
  const orderIds = cluster.order_ids || [];
  if (!orderIds.length) return false;
  const completedOrderIds = completedOrderIdsInState();
  return orderIds.every((id) => completedOrderIds.has(id));
}

function visibleActionableBatches(report = currentReport) {
  const actionable = report?.actionable_batches || report?.clusters || [];
  return actionable.filter((cluster) => !isClusterFullyCompleted(cluster));
}

function activeBatchesForCount(orderCount) {
  const prefix = `COUNT-${orderCount}`;
  return (batchState.active || []).filter((batch) => (
    batch.sub_batch_id === prefix ||
    String(batch.sub_batch_id || '').startsWith(`${prefix}-`)
  ));
}

function quickCountSummary(orderCount, report = currentReport) {
  const unavailableIds = new Set([...activeBatchOrderIds(), ...completedOrderIdsInState()]);
  const matchingRows = visibleActionableBatches(report)
    .filter((cluster) => Number(cluster.order_count || 0) === Number(orderCount || 0));
  const availableOrderIds = new Set();
  const availableOrderNumbers = new Map();
  matchingRows.forEach((cluster) => {
    (cluster.order_ids || []).forEach((id) => {
      if (unavailableIds.has(id)) return;
      availableOrderIds.add(id);
      const index = (cluster.order_ids || []).indexOf(id);
      availableOrderNumbers.set(id, (cluster.order_numbers || [])[index]);
    });
  });
  return {
    rows: matchingRows.filter((cluster) => (cluster.order_ids || []).some((id) => availableOrderIds.has(id))).length,
    orders: availableOrderIds.size,
    order_ids: [...availableOrderIds],
    order_numbers: [...availableOrderIds].map((id) => availableOrderNumbers.get(id)).filter(Boolean),
    source_batches: matchingRows
      .filter((cluster) => (cluster.order_ids || []).some((id) => availableOrderIds.has(id)))
      .map((cluster) => ({
        sub_batch_id: cluster.sub_batch_id,
        signature: cluster.signature,
        label: cluster.label,
        order_count: cluster.order_count,
        order_ids: (cluster.order_ids || []).filter((id) => availableOrderIds.has(id)),
        total_revenue: cluster.total_revenue,
        estimated_minutes: cluster.estimated_minutes,
        station: cluster.station,
        package: cluster.package,
        carrier_label: cluster.carrier_label
      }))
  };
}

function renderQuickBatchActions(report = currentReport) {
  if (!quickBatchActions) return;
  if (!report || report.empty) {
    quickBatchActions.innerHTML = '<span class="quick-batch-empty">Run Live Re-analyze first.</span>';
    return;
  }

  quickBatchActions.innerHTML = [1, 2, 3].map((orderCount) => {
    const activeBatches = activeBatchesForCount(orderCount);
    const summary = quickCountSummary(orderCount, report);
    if (activeBatches.length) {
      return `
        <div class="quick-count-group">
          <strong>${orderCount}-count active · ${activeBatches.length} tag${activeBatches.length === 1 ? '' : 's'}</strong>
          ${activeBatches.map((active) => `
            <div class="quick-count-active">
              <div>
                <strong>${escapeHtml(active.label || `${orderCount}-count batch`)}</strong>
                <span>${Number(active.order_count || 0)} orders${active.tag_id ? ` · Veeqo ID ${escapeHtml(active.tag_id)}` : ''}</span>
              </div>
              <code>${escapeHtml(active.tag_name || 'No tag name')}</code>
              <div class="quick-count-links">
                <button class="copy-tag" type="button" data-tag-name="${escapeHtml(active.tag_name || '')}">Copy</button>
                <a class="open-veeqo" target="_blank" rel="noopener" href="${escapeHtml(veeqoUrlForTag(active.tag_name, active.tag_id || ''))}" data-tag-name="${escapeHtml(active.tag_name || '')}" data-tag-id="${escapeHtml(active.tag_id || '')}">Open Veeqo</a>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    const disabled = !summary.orders;
    const detail = `${summary.rows} rows · ${summary.orders} orders`;
    return `
      <button class="quick-count-batch" type="button" data-order-count="${orderCount}"${disabled ? ' disabled' : ''}>
        <strong>Generate ${orderCount}-count</strong>
        <span>${escapeHtml(detail)}</span>
      </button>
    `;
  }).join('');
}

function getHistoryTotals() {
  const completed = batchState.completed || [];
  return {
    batches: completed.length,
    orders: completed.reduce((sum, batch) => sum + Number(batch.order_count || 0), 0),
    seconds: completed.reduce((sum, batch) => sum + Number(batch.duration_seconds || 0), 0),
    estimateSeconds: completed.reduce((sum, batch) => sum + Number(batch.estimated_minutes || 0) * 60, 0)
  };
}

function renderSummary(report) {
  if (!report || report.empty) return;
  document.querySelectorAll('.summary-notice').forEach((notice) => notice.remove());
  const currentOrderIds = new Set((report.actionable_batches || report.clusters || []).flatMap((batch) => batch.order_ids || []));
  const relevantCompleted = batchState.completed.filter((batch) => (batch.order_ids || []).some((id) => currentOrderIds.has(id)));
  const completedOrderCount = relevantCompleted.reduce((sum, batch) => sum + Number(batch.order_count || 0), 0);
  const completedRevenue = relevantCompleted.reduce((sum, batch) => sum + Number(batch.total_revenue || 0), 0);
  const openOrders = Math.max(0, report.summary.included_orders - completedOrderCount);
  const openRevenue = Math.max(0, report.summary.total_revenue - completedRevenue);
  const carrierLookup = report.summary.carrier_lookup || {};
  const skipped = report.summary.skipped || {};
  const issueSummary = report.summary.issues || {};
  const totals = getHistoryTotals();
  summaryGrid.innerHTML = [
    metric('Channel', report.channel_filter),
    metric('Source', report.data_source || 'live Veeqo'),
    metric('Status', report.status || 'awaiting_fulfillment'),
    metric('Pulled From Veeqo', report.orders_pulled ?? 0),
    metric('In This Channel', report.summary.source_orders ?? 0),
    metric('Held Orders', report.summary.held_orders ?? 0),
    metric('Batchable Orders', report.summary.batchable_orders ?? report.summary.included_orders ?? 0),
    metric('Completed Locally', report.summary.local_completed_orders ?? 0),
    metric('Open Batchable', report.summary.open_batchable_orders ?? report.summary.label_needed_orders ?? report.summary.included_orders ?? 0),
    metric('Need Labels', report.summary.label_needed_orders ?? report.summary.included_orders ?? 0),
    metric('Labels Already Bought', report.summary.label_purchased_orders ?? 0),
    metric('Included Orders', report.summary.included_orders ?? 0),
    metric('Sync Mode', carrierLookup.basis === 'shipping_rate_with_delivery_method_fallback' ? 'Carrier refresh' : 'Fast sync'),
    metric('Carrier Basis', carrierLookup.basis === 'fast_cached_delivery_fallback' ? 'Cache + fallback' : carrierLookup.basis === 'shipping_rate_with_delivery_method_fallback' ? 'Veeqo rates' : 'Delivery field'),
    metric('Carrier Cache', `${carrierLookup.cached ?? 0} cached / ${carrierLookup.enriched ?? 0} new / ${carrierLookup.cache_miss ?? 0} fallback`),
    metric('Open Orders', openOrders),
    metric('Fulfilled Here', completedOrderCount),
    metric('All-Time Processed', totals.orders),
    metric('All-Time Work Time', minutes(totals.seconds / 60)),
    metric('Issue Orders', issueSummary.total_orders ?? 0),
    metric('Hold Issues', issueSummary.hold_orders ?? 0),
    metric('Fraud / Risk', issueSummary.by_type?.fraud ?? 0),
    metric('Skipped Non-GMA', skipped.non_gma_only ?? 0),
    metric('Skipped Mixed', skipped.mixed_gma_and_non_gma ?? 0),
    metric('No Usable Items', skipped.no_items ?? 0),
    metric('Clusters', report.clusters.length),
    metric('Batch Candidates', report.summary.buckets.batch),
    metric('Borderline', report.summary.buckets.borderline),
    metric('Multipack', report.summary.buckets.multipack),
    metric('Open Revenue', money(openRevenue)),
    metric('Total Forecast', minutes(report.summary.estimated_minutes)),
    metric('Generated', new Date(report.generated_at).toLocaleString())
  ].join('');
  renderTeamForecast();
  renderIssueView(report);
  renderHistoryView();
}

function renderCluster(cluster) {
  const safeSubBatchId = escapeHtml(cluster.sub_batch_id || cluster.signature);
  const carrierSource = cluster.carrier_source ? ` · ${cluster.carrier_source}` : '';
  const activeBatch = activeBatchForSubBatch(cluster.sub_batch_id);
  const issueOrderIds = new Set((currentReport?.order_issues || []).map((issue) => issue.order_id));
  const issueCount = (cluster.order_ids || []).filter((id) => issueOrderIds.has(id)).length;
  const action = activeBatch
    ? `<div class="batch-actions">
        <button type="button" disabled>Active</button>
        <a class="open-veeqo" target="_blank" rel="noopener" href="${escapeHtml(veeqoUrlForTag(activeBatch.tag_name, activeBatch.tag_id || ''))}" data-tag-name="${escapeHtml(activeBatch.tag_name)}" data-tag-id="${escapeHtml(activeBatch.tag_id || '')}">Open Veeqo</a>
      </div>`
    : `<button class="start-batch" type="button" data-sub-batch-id="${safeSubBatchId}">Start Batch</button>`;

  return `
    <article class="cluster">
      <div>
        <h3>${escapeHtml(cluster.label)}</h3>
        <p>${escapeHtml(cluster.signature)} · ${escapeHtml(cluster.carrier_label || 'Unknown')}${escapeHtml(carrierSource)}</p>
      </div>
      <div class="cell"><span>Orders</span><strong>${cluster.order_count}</strong></div>
      <div class="cell"><span>Issues</span><strong>${issueCount}</strong></div>
      <div class="cell"><span>Revenue</span><strong>${money(cluster.total_revenue)}</strong></div>
      <div class="cell"><span>Estimate</span><strong>${minutes(cluster.estimated_minutes)}</strong></div>
      <div class="cell"><span>Station / Package</span><strong>${escapeHtml(cluster.station)}</strong>${packageControl(cluster, 'batch')}</div>
      ${action}
    </article>
  `;
}

function renderSection(name, clusters) {
  const sortedClusters = [...clusters].sort((a, b) => (
    Number(b.order_count || 0) - Number(a.order_count || 0)
    || String(a.label || '').localeCompare(String(b.label || ''))
  ));
  sections[name].count.textContent = clusters.length;
  sections[name].list.innerHTML = clusters.length
    ? sortedClusters.map(renderCluster).join('')
    : '<p class="empty">None right now.</p>';
}

function renderReportSections(report) {
  const actionable = visibleActionableBatches(report);
  renderSection('batch', actionable.filter((cluster) => cluster.bucket === 'batch'));
  renderSection('borderline', actionable.filter((cluster) => cluster.bucket === 'borderline'));
  renderSection('multipack', actionable.filter((cluster) => cluster.bucket === 'multipack'));
  renderQuickBatchActions(report);
}

function renderReport(report) {
  if (!report || report.empty) {
    summaryGrid.innerHTML = '<div class="metric"><span>Status</span><strong>No report yet</strong></div>';
    Object.values(sections).forEach((section) => {
      section.count.textContent = '0';
      section.list.innerHTML = '<p class="empty">Run an analysis first.</p>';
    });
    renderQuickBatchActions(null);
    renderIssueView(null);
    renderHistoryView();
    return;
  }

  currentReport = report;
  channelInput.value = report.channel_filter || channelInput.value;
  renderSummary(report);
  renderChart(report);
  renderBatches();
  renderPrepView();
  renderReportSections(report);
}

function renderChart(report) {
  const actionable = visibleActionableBatches(report);
  const groups = [
    { label: 'Batch', count: actionable.filter((cluster) => cluster.bucket === 'batch').reduce((sum, cluster) => sum + cluster.order_count, 0) },
    { label: 'Borderline', count: actionable.filter((cluster) => cluster.bucket === 'borderline').reduce((sum, cluster) => sum + cluster.order_count, 0) },
    { label: 'Multipack', count: actionable.filter((cluster) => cluster.bucket === 'multipack').reduce((sum, cluster) => sum + cluster.order_count, 0) }
  ];
  const max = Math.max(1, ...groups.map((group) => group.count));
  chartBars.innerHTML = groups.map((group) => `
    <div class="bar-row">
      <span>${group.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width: ${(group.count / max) * 100}%"></div></div>
      <strong>${group.count}</strong>
    </div>
  `).join('');
}

function renderTeamForecast() {
  if (!currentReport) return;
  const teamSize = Math.max(1, Number.parseInt(teamSizeInput.value || '1', 10));
  const stationCount = Math.max(1, Number.parseInt(stationCountInput.value || '1', 10));
  const adjustedMinutes = currentReport.summary.estimated_minutes / stationCount;
  teamForecast.textContent = `${teamSize} team member${teamSize === 1 ? '' : 's'} · ${stationCount} active station${stationCount === 1 ? '' : 's'} · ${minutes(adjustedMinutes)} estimated elapsed time`;
}

function findCluster(subBatchId) {
  const actionable = currentReport?.actionable_batches || currentReport?.clusters || [];
  return actionable.find((cluster) => cluster.sub_batch_id === subBatchId || cluster.signature === subBatchId);
}

async function startBatch(subBatchId, button) {
  const cluster = findCluster(subBatchId);
  if (!cluster) return;
  setButtonProcessing(button, true, 'Starting...');
  try {
    const response = await handleAuthResponse(await fetch('/api/batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub_batch_id: subBatchId })
    }));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to start batch');
    await loadBatches();
    try {
      await copyText(result.batch.tag_name);
      showToast(`Batch started and tag copied: ${result.batch.tag_name}`);
    } catch {
      showToast(`Batch started: ${result.batch.tag_name}`);
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonProcessing(button, false);
  }
}

async function startCountBatch(orderCount, button) {
  const summary = quickCountSummary(orderCount);
  if (!summary.orders) {
    showToast(`No available ${orderCount}-count orders to batch.`);
    return;
  }
  setButtonProcessing(button, true, 'Starting...');
  try {
    const response = await handleAuthResponse(await fetch('/api/batches/by-count', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_count: Number(orderCount),
        order_ids: summary.order_ids,
        order_numbers: summary.order_numbers,
        source_batches: summary.source_batches
      })
    }));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to start count batch');
    await loadBatches();
    const createdBatches = Array.isArray(result.batches) && result.batches.length ? result.batches : [result.batch].filter(Boolean);
    const firstTag = createdBatches[0]?.tag_name || result.batch?.tag_name;
    try {
      await copyText(firstTag);
      showToast(`${createdBatches.length} count batch tag${createdBatches.length === 1 ? '' : 's'} started. First tag copied: ${firstTag}`);
    } catch {
      showToast(`${createdBatches.length} count batch tag${createdBatches.length === 1 ? '' : 's'} started.`);
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonProcessing(button, false);
  }
}

async function completeBatch(batchId, button) {
  setButtonProcessing(button, true, 'Completing...');
  try {
    const response = await handleAuthResponse(await fetch(`/api/batches/${encodeURIComponent(batchId)}/complete`, { method: 'POST' }));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to complete batch');
    await loadBatches();
    showToast(`Batch complete. Tag cleanup: ${result.batch.cleanup_status}`);
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonProcessing(button, false);
  }
}

async function reopenBatch(batchId, button) {
  setButtonProcessing(button, true, 'Reopening...');
  try {
    const response = await handleAuthResponse(await fetch(`/api/batches/${encodeURIComponent(batchId)}/reopen`, { method: 'POST' }));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to reopen batch');
    await loadBatches();
    showToast(`Batch reopened as paused. Tag status: ${result.batch.cleanup_status}`);
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonProcessing(button, false);
  }
}

async function cancelBatch(batchId, button) {
  setButtonProcessing(button, true, 'Canceling...');
  try {
    const response = await handleAuthResponse(await fetch(`/api/batches/${encodeURIComponent(batchId)}/cancel`, { method: 'POST' }));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to cancel batch');
    await loadBatches();
    showToast(`Batch canceled. Tag cleanup: ${result.batch.cleanup_status}`);
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonProcessing(button, false);
  }
}

async function pauseBatch(batchId, button) {
  setButtonProcessing(button, true, 'Pausing...');
  try {
    const response = await handleAuthResponse(await fetch(`/api/batches/${encodeURIComponent(batchId)}/pause`, { method: 'POST' }));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to pause batch');
    await loadBatches();
    showToast(`Batch paused: ${result.batch.tag_name}`);
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonProcessing(button, false);
  }
}

async function resumeBatch(batchId, button) {
  setButtonProcessing(button, true, 'Resuming...');
  try {
    const response = await handleAuthResponse(await fetch(`/api/batches/${encodeURIComponent(batchId)}/resume`, { method: 'POST' }));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to resume batch');
    await loadBatches();
    showToast(`Batch resumed: ${result.batch.tag_name}`);
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonProcessing(button, false);
  }
}

async function updateLabelCarrier(batchId, carrier) {
  const response = await handleAuthResponse(await fetch(`/api/batches/${encodeURIComponent(batchId)}/label-carrier`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ carrier })
  }));
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to save carrier');

  const updateBatch = (batch) => batch.id === batchId ? { ...batch, print_carrier: carrier } : batch;
  batchState = {
    ...batchState,
    active: (batchState.active || []).map(updateBatch),
    completed: (batchState.completed || []).map(updateBatch)
  };
  renderBatches();
  showToast(carrier ? `Label carrier saved: ${carrier}` : 'Label carrier cleared.');
}

async function recheckIssueOrder(orderId, button) {
  setButtonProcessing(button, true, 'Checking...');
  try {
    const response = await handleAuthResponse(await fetch(`/api/issues/${encodeURIComponent(orderId)}/recheck`, { method: 'POST' }));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to recheck order');

    if (currentReport) {
      const nextIssues = result.issue
        ? (currentReport.order_issues || []).map((issue) => issue.order_id === result.issue.order_id ? result.issue : issue)
        : (currentReport.order_issues || []).filter((issue) => String(issue.order_id) !== String(orderId));
      currentReport = {
        ...currentReport,
        order_issues: nextIssues,
        summary: {
          ...currentReport.summary,
          issues: {
            total_orders: nextIssues.length,
            hold_orders: nextIssues.filter((issue) => issue.severity === 'hold').length,
            warning_orders: nextIssues.filter((issue) => issue.severity !== 'hold').length,
            by_type: nextIssues.reduce((counts, issue) => {
              (issue.issue_types || []).forEach((type) => {
                counts[type] = (counts[type] || 0) + 1;
              });
              return counts;
            }, { phone: 0, address: 0, fraud: 0, shipping: 0 })
          }
        }
      };
      renderSummary(currentReport);
      renderReportSections(currentReport);
    }

    if (result.status === 'cleared') {
      showToast(`Cleared: ${result.order_number}. Run Live Re-analyze to return it to processing.`);
    } else if (result.status === 'held') {
      const details = result.issue?.issues?.map((issue) => issue.detail).filter(Boolean).join('; ');
      showToast(`Still held: ${result.order_number}${details ? ` - ${details}` : ''}`);
    } else {
      showToast(`Warning remains: ${result.order_number}`);
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonProcessing(button, false);
  }
}

async function loadBatches() {
  const response = await handleAuthResponse(await fetch('/api/batches'));
  batchState = await response.json();
  if (currentReport) {
    renderSummary(currentReport);
    renderReportSections(currentReport);
  }
  renderBatches();
  renderPrepView();
}

function renderBatches() {
  const running = batchState.active || [];
  activeBatchCount.textContent = running.length;
  activeBatches.innerHTML = running.length
    ? running.map((batch) => {
      const paused = batch.status === 'paused';
      return `
      <article class="cluster active">
        <div>
          <h3>${escapeHtml(batch.label)}</h3>
          <div class="tag-row">
            <code>${escapeHtml(batch.tag_name)}</code>
            <button class="copy-tag" type="button" data-tag-name="${escapeHtml(batch.tag_name)}">Copy</button>
            <a class="open-veeqo" target="_blank" rel="noopener" href="${escapeHtml(veeqoUrlForTag(batch.tag_name, batch.tag_id || ''))}" data-tag-name="${escapeHtml(batch.tag_name)}" data-tag-id="${escapeHtml(batch.tag_id || '')}">Open Veeqo</a>
          </div>
          <p>Started ${new Date(batch.started_at).toLocaleTimeString()}</p>
        </div>
        <div class="cell"><span>Orders</span><strong>${batch.order_count}</strong></div>
        <div class="cell"><span>Carrier for label</span><strong>${escapeHtml(batch.carrier_label || 'Unknown')}</strong>${labelCarrierControl(batch)}</div>
        <div class="cell"><span>Estimate</span><strong>${minutes(batch.estimated_minutes || 0)}</strong></div>
        <div class="cell"><span>Elapsed</span><strong>${minutes(activeElapsedSeconds(batch) / 60)}</strong></div>
        <div class="cell"><span>Status</span><strong>${paused ? 'Paused' : 'Running'}</strong></div>
        <div class="batch-actions">
          <button class="print-batch-label" type="button" data-batch-id="${escapeHtml(batch.id)}">Print Batch Label</button>
          <button class="complete-batch" type="button" data-batch-id="${escapeHtml(batch.id)}">Mark Complete</button>
          <button class="${paused ? 'resume-batch' : 'pause-batch'}" type="button" data-batch-id="${escapeHtml(batch.id)}">${paused ? 'Resume' : 'Pause'}</button>
          <button class="cancel-batch" type="button" data-batch-id="${escapeHtml(batch.id)}">Cancel</button>
        </div>
      </article>
    `;
    }).join('')
    : '<p class="empty">No active batch timers.</p>';

  const completed = batchState.completed || [];
  completedBatchCount.textContent = completed.length;
  completedBatches.innerHTML = completed.length
    ? completed.slice(0, 12).map((batch) => `
      <article class="cluster complete">
        <div>
          <h3>${escapeHtml(batch.label)}</h3>
          <div class="tag-row">
            <code>${escapeHtml(batch.tag_name)}</code>
            <button class="copy-tag" type="button" data-tag-name="${escapeHtml(batch.tag_name)}">Copy</button>
          </div>
          <p>${escapeHtml(batch.cleanup_status)}</p>
        </div>
        <div class="cell"><span>Orders</span><strong>${batch.order_count}</strong></div>
        <div class="cell"><span>Carrier for label</span><strong>${escapeHtml(batch.carrier_label || 'Unknown')}</strong>${labelCarrierControl(batch)}</div>
        <div class="cell"><span>Estimate</span><strong>${minutes(batch.estimated_minutes || 0)}</strong></div>
        <div class="cell"><span>Duration</span><strong>${minutes((batch.duration_seconds || 0) / 60)}</strong></div>
        <div class="cell"><span>Rate</span><strong>${Number(batch.orders_per_minute || 0).toFixed(1)}/min</strong></div>
        <div class="batch-actions">
          <button class="print-batch-label" type="button" data-batch-id="${escapeHtml(batch.id)}">Print Batch Label</button>
          <button class="reopen-batch" type="button" data-batch-id="${escapeHtml(batch.id)}">Reopen</button>
        </div>
      </article>
    `).join('')
    : '<p class="empty">No completed batches yet.</p>';
  renderHistoryView();
}

function activeBatchOrderIds() {
  return new Set((batchState.active || []).flatMap((batch) => batch.order_ids || []));
}

function activeBatchSignatures() {
  return new Set((batchState.active || []).map((batch) => batch.signature).filter(Boolean));
}

function rowIsInActiveBatch(row) {
  const activeSignatures = activeBatchSignatures();
  if (activeSignatures.has(row.signature)) return true;
  const activeOrderIds = activeBatchOrderIds();
  return (row.order_ids || []).some((id) => activeOrderIds.has(id));
}

function prepRows() {
  const rows = prepState.rows?.length ? prepState.rows : currentReport?.prep_rows || [];
  return sortPrepRowsBySharedItems(rows.filter((row) => !rowIsInActiveBatch(row)));
}

function syncSelectedPrepKeys(rows) {
  const visibleKeys = new Set(rows.map((row) => row.prep_key));
  selectedPrepKeys = new Set([...selectedPrepKeys].filter((key) => visibleKeys.has(key)));
}

function prepRowsSummary(rows) {
  const openRows = rows.filter((row) => !row.prepared);
  const preparedRows = rows.filter((row) => row.prepared);
  return {
    rows: rows.length,
    open_rows: openRows.length,
    prepared_rows: preparedRows.length,
    open_orders: openRows.reduce((sum, row) => sum + Number(row.order_count || 0), 0),
    prepared_orders: preparedRows.reduce((sum, row) => sum + Number(row.order_count || 0), 0),
    estimated_minutes: openRows.reduce((sum, row) => sum + Number(row.estimated_minutes || 0), 0)
  };
}

function renderPrepView() {
  if (!prepSummaryGrid || !prepTable || !prepTableCount) return;
  const rows = prepRows();
  syncSelectedPrepKeys(rows);
  const summary = prepRowsSummary(rows);
  prepSummaryGrid.innerHTML = [
    metric('Prep Rows', summary.rows ?? rows.length),
    metric('Open Rows', summary.open_rows ?? rows.filter((row) => !row.prepared).length),
    metric('Prepared Rows', summary.prepared_rows ?? rows.filter((row) => row.prepared).length),
    metric('Open Orders', summary.open_orders ?? rows.filter((row) => !row.prepared).reduce((sum, row) => sum + row.order_count, 0)),
    metric('Prepared Orders', summary.prepared_orders ?? rows.filter((row) => row.prepared).reduce((sum, row) => sum + row.order_count, 0)),
    metric('Open Prep Time', minutes(summary.estimated_minutes || 0))
  ].join('');
  printPrepButton.textContent = `Print Selected Prep (${selectedPrepKeys.size})`;
  prepTableCount.textContent = rows.length;
  prepTable.innerHTML = rows.length ? `
    <div class="prep-toolbar">
      <button id="selectVisiblePrepButton" type="button">Select All Visible</button>
      <button id="clearPrepSelectionButton" type="button">Clear Selection</button>
      <span>${selectedPrepKeys.size} selected</span>
    </div>
    <div class="data-table prep-table">
      <div class="table-row table-head">
        <span>Select</span><span>Order Mix</span><span>Orders</span><span>Package</span><span>Kit / Item Staging</span><span>Status</span>
      </div>
      ${rows.map((row) => `
        <div class="table-row prep-row${row.prepared ? ' prepared' : ''}">
          <span>
            <input class="prep-row-select" type="checkbox" data-prep-key="${escapeHtml(row.prep_key)}"${selectedPrepKeys.has(row.prep_key) ? ' checked' : ''}${row.prepared ? ' disabled' : ''}>
          </span>
          <span>
            <strong>${escapeHtml(row.label)}</strong>
            <small>${escapeHtml(row.signature)}</small>
          </span>
          <span>${row.order_count}</span>
          <span>${packageControl(row)}</span>
          <span>${escapeHtml(prepKitSummary(row) || prepItemLabels(row).join(' + ') || row.label)}</span>
          <span>
            <button class="${row.prepared ? 'undo-prep' : 'mark-prepared'}" type="button" data-signature="${escapeHtml(row.signature)}" data-label="${escapeHtml(row.label)}" data-package="${escapeHtml(row.package)}">${row.prepared ? 'Undo Prepared' : 'Mark Prepared'}</button>
          </span>
        </div>
      `).join('')}
    </div>
  ` : '<p class="empty">No prep rows found in the current analysis.</p>';
}

async function loadPrep() {
  const response = await handleAuthResponse(await fetch('/api/prep'));
  prepState = await response.json();
  renderPrepView();
}

function parseDataItems(value) {
  try {
    return JSON.parse(value || '[]');
  } catch {
    return [];
  }
}

async function updatePrepPackage(signature, label, packageName, category = '', items = []) {
  const response = await handleAuthResponse(await fetch('/api/prep/package', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature, label, package: packageName, category, items })
  }));
  prepState = await response.json();
  if (currentReport) {
    currentReport = {
      ...currentReport,
      clusters: updateRowsPackage(currentReport.clusters, signature, packageName),
      actionable_batches: updateRowsPackage(currentReport.actionable_batches, signature, packageName),
      prep_rows: updateRowsPackage(currentReport.prep_rows, signature, packageName)
    };
    renderReportSections(currentReport);
  }
  renderPrepView();
  showToast('Prep package saved.');
}

function updateRowsPackage(rows, signature, packageName) {
  return (rows || []).map((row) => {
    if (row.signature !== signature) {
      return {
        ...row,
        sub_batches: updateRowsPackage(row.sub_batches, signature, packageName)
      };
    }
    return {
      ...row,
      package: packageName,
      package_overridden: true,
      package_suggestion_source: 'exact',
      sub_batches: updateRowsPackage(row.sub_batches, signature, packageName)
    };
  });
}

async function updateBatchPackage(signature, label, packageName, category = '', items = []) {
  const response = await handleAuthResponse(await fetch('/api/prep/package', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature, label, package: packageName, category, items })
  }));
  prepState = await response.json();
  if (currentReport) {
    currentReport = {
      ...currentReport,
      clusters: updateRowsPackage(currentReport.clusters, signature, packageName),
      actionable_batches: updateRowsPackage(currentReport.actionable_batches, signature, packageName),
      prep_rows: updateRowsPackage(currentReport.prep_rows, signature, packageName)
    };
    renderReportSections(currentReport);
    renderPrepView();
  }
  showToast('Batch package saved.');
}

async function updatePrepStatus(signature, label, packageName, prepared, button) {
  setButtonProcessing(button, true, prepared ? 'Saving...' : 'Undoing...');
  try {
    const response = await handleAuthResponse(await fetch('/api/prep/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature, label, package: packageName, prepared })
    }));
    prepState = await response.json();
    renderPrepView();
    showToast(prepared ? 'Prep row marked prepared.' : 'Prep row reopened.');
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonProcessing(button, false);
  }
}

function printPrepSheet() {
  const rows = prepRows();
  const selectedRows = rows.filter((row) => selectedPrepKeys.has(row.prep_key) && !row.prepared);
  if (!selectedRows.length) {
    showToast('Select at least one prep row to print.');
    return;
  }
  const matrixRows = prepMatrixRows(selectedRows);
  const content = `
    <!doctype html>
    <html>
      <head>
        <title>Prep Sheet</title>
        <style>
          @page { margin: 0.25in; size: landscape; }
          * { box-sizing: border-box; }
          body { color: #1c2430; font-family: Arial, sans-serif; margin: 0; }
          h1 { font-size: 18px; margin: 0 0 4px; }
          p { font-size: 11px; margin: 0 0 10px; }
          table { border-collapse: collapse; table-layout: fixed; width: 100%; }
          th, td { border: 1px solid #d9dee7; font-size: 10px; padding: 5px 6px; text-align: left; vertical-align: top; }
          th { background: #f5f7fa; font-weight: 700; }
          th:nth-child(1), td:nth-child(1) { width: 42px; }
          th:nth-child(2), td:nth-child(2) { width: 88px; }
          th:nth-child(3), td:nth-child(3) { width: 275px; }
          th:nth-child(n+4), td:nth-child(n+4) { text-align: center; width: 70px; }
        </style>
      </head>
      <body>
        <h1>Prep / Assembly Sheet</h1>
        <p>${escapeHtml(currentReport?.channel_filter || '')} · ${new Date().toLocaleString()} · ${selectedRows.length} prep rows · Prepare unsealed packages only.</p>
        <table>
          <thead>
            <tr>
              <th>Orders</th>
              <th>Package</th>
              <th>Item / Kit</th>
              ${prepMatrixColumns.map((column) => `<th>${escapeHtml(column.header)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${matrixRows.map(({ row, quantities }) => `
              <tr>
                <td>${row.order_count}</td>
                <td>${escapeHtml(row.package)}</td>
                <td>${escapeHtml(row.label)}</td>
                ${prepMatrixColumns.map((column) => `<td>${quantities[column.key] ? quantities[column.key] : ''}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
    </html>
  `;
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('Print window blocked.');
    return;
  }
  printWindow.document.write(content);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function renderIssueView(report = currentReport) {
  if (!issueSummaryGrid || !issueTable || !issueTableCount) return;
  const issues = report?.order_issues || [];
  const summary = report?.summary?.issues || { by_type: {} };
  issueSummaryGrid.innerHTML = [
    metric('Issue Orders', summary.total_orders || 0),
    metric('Hold', summary.hold_orders || 0),
    metric('Warnings', summary.warning_orders || 0),
    metric('Fraud Hold', summary.by_type?.fraud || 0),
    metric('Address Hold', summary.by_type?.address || 0),
    metric('Shipping Hold', summary.by_type?.shipping || 0)
  ].join('');
  issueTableCount.textContent = issues.length;
  issueTable.innerHTML = issues.length ? `
    <div class="data-table">
      <div class="table-row table-head">
        <span>Order</span><span>Customer</span><span>Severity</span><span>Issues</span><span>Links</span>
      </div>
      ${issues.map((issue) => `
        <div class="table-row">
          <span>${escapeHtml(issue.order_number)}</span>
          <span>${escapeHtml(issue.customer || '')}</span>
          <span><strong>${issue.severity === 'hold' ? 'Hold' : 'Warning'}</strong></span>
          <span>${issue.issues.map((item) => `${escapeHtml(item.label)}: ${escapeHtml(item.detail)}`).join('<br>')}</span>
          <span class="link-row">
            <a target="_blank" rel="noopener" href="${escapeHtml(issue.veeqo_url)}">Veeqo</a>
            ${issue.shopify_url ? `<a target="_blank" rel="noopener" href="${escapeHtml(issue.shopify_url)}">Shopify</a>` : ''}
            <button class="recheck-issue" type="button" data-order-id="${escapeHtml(issue.order_id)}">Recheck</button>
          </span>
        </div>
      `).join('')}
    </div>
  ` : '<p class="empty">No issue orders found in the current analysis.</p>';
}

function renderHistoryView() {
  if (!historySummaryGrid || !historyTable || !historyTableCount) return;
  const completed = batchState.completed || [];
  const totals = getHistoryTotals();
  historySummaryGrid.innerHTML = [
    metric('Completed Batches', totals.batches),
    metric('Orders Processed', totals.orders),
    metric('Estimated Time', minutes(totals.estimateSeconds / 60)),
    metric('Actual Time', minutes(totals.seconds / 60)),
    metric('Avg Rate', totals.seconds ? `${(totals.orders / (totals.seconds / 60)).toFixed(1)}/min` : '0.0/min')
  ].join('');
  historyTableCount.textContent = completed.length;
  historyTable.innerHTML = completed.length ? `
    <div class="data-table history-table">
      <div class="table-row table-head">
        <span>Batch</span><span>Tag</span><span>Orders</span><span>Carrier</span><span>Estimate</span><span>Actual</span><span>Completed</span><span>Cleanup</span><span>Action</span>
      </div>
      ${completed.map((batch) => `
        <div class="table-row history-row">
          <span>${escapeHtml(batch.label)}</span>
          <span><code>${escapeHtml(batch.tag_name)}</code></span>
          <span>${batch.order_count}</span>
          <span>${escapeHtml(batch.carrier_label || 'Unknown')}</span>
          <span>${minutes(batch.estimated_minutes || 0)}</span>
          <span>${minutes((batch.duration_seconds || 0) / 60)}</span>
          <span>${batch.completed_at ? new Date(batch.completed_at).toLocaleString() : ''}</span>
          <span>${escapeHtml(batch.cleanup_status || '')}</span>
          <span><button class="reopen-batch" type="button" data-batch-id="${escapeHtml(batch.id)}">Reopen</button></span>
        </div>
      `).join('')}
    </div>
  ` : '<p class="empty">No completed batches yet.</p>';
}

async function loadLatest() {
  const response = await handleAuthResponse(await fetch('/api/latest-analysis'));
  const report = await response.json();
  await loadBatches();
  await loadPrep();
  renderReport(report);
}

async function loadPortalConfig() {
  const response = await handleAuthResponse(await fetch('/api/session'));
  portalConfig = { ...portalConfig, ...(await response.json()) };
  if (!channelInput.value.trim() && portalConfig.default_channel_filter) {
    channelInput.value = portalConfig.default_channel_filter;
  }
}

async function scanChannels() {
  setButtonProcessing(channelScanButton, true, 'Checking...');
  try {
    const response = await handleAuthResponse(await fetch('/api/channels'));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Channel check failed');

    channelOptions.innerHTML = data.channels
      .map((channel) => `<option value="${escapeHtml(channel.name)}">${escapeHtml(channel.name)} (${channel.count})</option>`)
      .join('');

    if (data.channels.length) {
      const current = channelInput.value.trim();
      const exact = data.channels.some((channel) => channel.name.toLowerCase() === current.toLowerCase());
      if (!exact) channelInput.value = data.channels[0].name;
      showToast(`Found ${data.channels.length} ready-to-ship channels. Top: ${data.channels[0].name} (${data.channels[0].count}).`);
    } else {
      showToast(`No ready-to-ship channels found for ${data.status}.`);
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonProcessing(channelScanButton, false);
  }
}

async function refreshAnalysis({ demo = false, refreshCarriers = false } = {}) {
  refreshButton.disabled = true;
  carrierRefreshButton.disabled = true;
  demoButton.disabled = true;
  const activeButton = demo ? demoButton : refreshCarriers ? carrierRefreshButton : refreshButton;
  setButtonProcessing(activeButton, true, refreshCarriers ? 'Refreshing...' : 'Analyzing...');
  try {
    const params = new URLSearchParams();
    if (demo) params.set('demo', '1');
    if (refreshCarriers) params.set('refresh_carriers', '1');
    if (!demo && channelInput.value.trim()) params.set('channel', channelInput.value.trim());
    const response = await handleAuthResponse(await fetch(`/api/analyze?${params.toString()}`, { method: 'POST' }));
    const report = await response.json();
    if (!response.ok) throw new Error(report.error || 'Analyze failed');
    prepState = { rows: report.prep_rows || [], summary: report.summary?.prep || {} };
    renderReport(report);
    if (!demo && Number(report.summary?.included_orders || 0) === 0) {
      showToast(`No included orders. Pulled ${report.orders_pulled || 0}; channel matched ${report.summary?.source_orders || 0}.`);
    } else {
      showToast(demo ? 'Demo analysis loaded.' : refreshCarriers ? 'Carrier refresh complete.' : 'Fast live analysis refreshed.');
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    refreshButton.disabled = false;
    carrierRefreshButton.disabled = false;
    demoButton.disabled = false;
    setButtonProcessing(activeButton, false);
  }
}

refreshButton.addEventListener('click', () => refreshAnalysis());
carrierRefreshButton.addEventListener('click', () => refreshAnalysis({ refreshCarriers: true }));
demoButton.addEventListener('click', () => refreshAnalysis({ demo: true }));
channelScanButton.addEventListener('click', scanChannels);
printPrepButton.addEventListener('click', printPrepSheet);
logoutButton.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});
teamSizeInput.addEventListener('input', renderTeamForecast);
stationCountInput.addEventListener('input', renderTeamForecast);
document.querySelectorAll('.view-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.view-button').forEach((item) => item.classList.toggle('active', item === button));
    document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active-view', view.id === button.dataset.view));
  });
});
document.addEventListener('click', (event) => {
  const collapseButton = event.target.closest('.collapse-toggle');
  if (collapseButton) {
    toggleCollapsedSection(collapseButton.closest('.collapsible-section'));
    return;
  }

  const selectVisiblePrepButton = event.target.closest('#selectVisiblePrepButton');
  if (selectVisiblePrepButton) {
    selectedPrepKeys = new Set(prepRows().filter((row) => !row.prepared).map((row) => row.prep_key));
    renderPrepView();
    return;
  }

  const clearPrepSelectionButton = event.target.closest('#clearPrepSelectionButton');
  if (clearPrepSelectionButton) {
    selectedPrepKeys.clear();
    renderPrepView();
    return;
  }

  const startButton = event.target.closest('.start-batch');
  if (startButton) startBatch(startButton.dataset.subBatchId, startButton);

  const quickCountButton = event.target.closest('.quick-count-batch');
  if (quickCountButton) startCountBatch(quickCountButton.dataset.orderCount, quickCountButton);

  const printBatchLabelButton = event.target.closest('.print-batch-label');
  if (printBatchLabelButton) printBatchLabel(printBatchLabelButton.dataset.batchId);

  const completeButton = event.target.closest('.complete-batch');
  if (completeButton) completeBatch(completeButton.dataset.batchId, completeButton);

  const reopenButton = event.target.closest('.reopen-batch');
  if (reopenButton) reopenBatch(reopenButton.dataset.batchId, reopenButton);

  const cancelButton = event.target.closest('.cancel-batch');
  if (cancelButton) cancelBatch(cancelButton.dataset.batchId, cancelButton);

  const pauseButton = event.target.closest('.pause-batch');
  if (pauseButton) pauseBatch(pauseButton.dataset.batchId, pauseButton);

  const resumeButton = event.target.closest('.resume-batch');
  if (resumeButton) resumeBatch(resumeButton.dataset.batchId, resumeButton);

  const markPreparedButton = event.target.closest('.mark-prepared');
  if (markPreparedButton) updatePrepStatus(markPreparedButton.dataset.signature, markPreparedButton.dataset.label, markPreparedButton.dataset.package, true, markPreparedButton);

  const undoPrepButton = event.target.closest('.undo-prep');
  if (undoPrepButton) updatePrepStatus(undoPrepButton.dataset.signature, undoPrepButton.dataset.label, undoPrepButton.dataset.package, false, undoPrepButton);

  const recheckIssueButton = event.target.closest('.recheck-issue');
  if (recheckIssueButton) recheckIssueOrder(recheckIssueButton.dataset.orderId, recheckIssueButton);

  const copyButton = event.target.closest('.copy-tag');
  if (copyButton) {
    copyText(copyButton.dataset.tagName)
      .then(() => showToast(`Copied: ${copyButton.dataset.tagName}`))
      .catch(() => showToast('Could not copy tag.'));
  }

});
document.addEventListener('change', (event) => {
  const prepRowSelect = event.target.closest('.prep-row-select');
  if (prepRowSelect) {
    if (prepRowSelect.checked) selectedPrepKeys.add(prepRowSelect.dataset.prepKey);
    else selectedPrepKeys.delete(prepRowSelect.dataset.prepKey);
    renderPrepView();
    return;
  }

  const carrierSelect = event.target.closest('.label-carrier-select');
  if (carrierSelect) {
    updateLabelCarrier(carrierSelect.dataset.batchId, carrierSelect.value).catch((error) => showToast(error.message));
    return;
  }

  const select = event.target.closest('.prep-package-select, .batch-package-select');
  if (!select) return;
  const customInput = select.parentElement.querySelector('.prep-package-custom');
  const batchCustomInput = select.parentElement.querySelector('.batch-package-custom');
  const input = customInput || batchCustomInput;
  if (select.value === '__custom__') {
    input.hidden = false;
    input.focus();
    return;
  }
  input.hidden = true;
  input.value = '';
  const items = parseDataItems(select.dataset.items);
  if (select.classList.contains('batch-package-select')) updateBatchPackage(select.dataset.signature, select.dataset.label, select.value, select.dataset.category, items);
  else updatePrepPackage(select.dataset.signature, select.dataset.label, select.value, select.dataset.category, items);
});
document.addEventListener('blur', (event) => {
  const input = event.target.closest('.prep-package-custom, .batch-package-custom');
  if (!input || input.hidden) return;
  const value = input.value.trim();
  if (!value) return;
  const items = parseDataItems(input.dataset.items);
  if (input.classList.contains('batch-package-custom')) updateBatchPackage(input.dataset.signature, input.dataset.label, value, input.dataset.category, items);
  else updatePrepPackage(input.dataset.signature, input.dataset.label, value, input.dataset.category, items);
}, true);
window.setInterval(() => {
  if ((batchState.active || []).length) renderBatches();
}, 30000);
loadPortalConfig()
  .then(loadLatest)
  .then(applyCollapsedSections)
  .catch((error) => showToast(error.message));
