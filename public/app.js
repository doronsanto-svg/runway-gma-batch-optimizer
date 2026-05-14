const summaryGrid = document.querySelector('#summaryGrid');
const refreshButton = document.querySelector('#refreshButton');
const demoButton = document.querySelector('#demoButton');
const logoutButton = document.querySelector('#logoutButton');
const teamSizeInput = document.querySelector('#teamSizeInput');
const channelInput = document.querySelector('#channelInput');
const channelOptions = document.querySelector('#channelOptions');
const channelScanButton = document.querySelector('#channelScanButton');
const teamForecast = document.querySelector('#teamForecast');
const chartBars = document.querySelector('#chartBars');
const activeBatches = document.querySelector('#activeBatches');
const activeBatchCount = document.querySelector('#activeBatchCount');
const completedBatches = document.querySelector('#completedBatches');
const completedBatchCount = document.querySelector('#completedBatchCount');
const toast = document.querySelector('#statusToast');

let currentReport = null;
let batchState = { active: [], completed: [] };
let portalConfig = {
  veeqo_orders_url: 'https://app.veeqo.com/orders',
  veeqo_tag_filter_url_template: ''
};

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

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function activeBatchForSubBatch(subBatchId) {
  return (batchState.active || []).find((batch) => batch.sub_batch_id === subBatchId);
}

function renderSummary(report) {
  if (!report || report.empty) return;
  const currentOrderIds = new Set((report.actionable_batches || report.clusters || []).flatMap((batch) => batch.order_ids || []));
  const relevantCompleted = batchState.completed.filter((batch) => (batch.order_ids || []).some((id) => currentOrderIds.has(id)));
  const completedOrderCount = relevantCompleted.reduce((sum, batch) => sum + Number(batch.order_count || 0), 0);
  const completedRevenue = relevantCompleted.reduce((sum, batch) => sum + Number(batch.total_revenue || 0), 0);
  const openOrders = Math.max(0, report.summary.included_orders - completedOrderCount);
  const openRevenue = Math.max(0, report.summary.total_revenue - completedRevenue);
  const carrierLookup = report.summary.carrier_lookup || {};
  const skipped = report.summary.skipped || {};
  summaryGrid.innerHTML = [
    metric('Channel', report.channel_filter),
    metric('Source', report.data_source || 'live Veeqo'),
    metric('Status', report.status || 'awaiting_fulfillment'),
    metric('Pulled From Veeqo', report.orders_pulled ?? 0),
    metric('In This Channel', report.summary.source_orders ?? 0),
    metric('Included Orders', report.summary.included_orders ?? 0),
    metric('Carrier Basis', carrierLookup.basis === 'shipping_rate_with_delivery_method_fallback' ? 'Veeqo rates' : 'Delivery field'),
    metric('Open Orders', openOrders),
    metric('Fulfilled Here', completedOrderCount),
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
}

function renderCluster(cluster) {
  const safeSubBatchId = escapeHtml(cluster.sub_batch_id || cluster.signature);
  const carrierSource = cluster.carrier_source ? ` · ${cluster.carrier_source}` : '';
  const activeBatch = activeBatchForSubBatch(cluster.sub_batch_id);
  const action = activeBatch
    ? `<div class="batch-actions">
        <button type="button" disabled>Active</button>
        <a class="open-veeqo" href="${escapeHtml(veeqoUrlForTag(activeBatch.tag_name, activeBatch.tag_id || ''))}" data-tag-name="${escapeHtml(activeBatch.tag_name)}" data-tag-id="${escapeHtml(activeBatch.tag_id || '')}">Open Veeqo</a>
      </div>`
    : `<button class="start-batch" type="button" data-sub-batch-id="${safeSubBatchId}">Start Batch</button>`;

  return `
    <article class="cluster">
      <div>
        <h3>${escapeHtml(cluster.label)}</h3>
        <p>${escapeHtml(cluster.signature)} · ${escapeHtml(cluster.carrier_label || 'Unknown')}${escapeHtml(carrierSource)}</p>
      </div>
      <div class="cell"><span>Orders</span><strong>${cluster.order_count}</strong></div>
      <div class="cell"><span>Revenue</span><strong>${money(cluster.total_revenue)}</strong></div>
      <div class="cell"><span>Estimate</span><strong>${minutes(cluster.estimated_minutes)}</strong></div>
      <div class="cell"><span>Station / Package</span><strong>${escapeHtml(cluster.station)} · ${escapeHtml(cluster.package)}</strong></div>
      ${action}
    </article>
  `;
}

function renderSection(name, clusters) {
  sections[name].count.textContent = clusters.length;
  sections[name].list.innerHTML = clusters.length
    ? clusters.map(renderCluster).join('')
    : '<p class="empty">None right now.</p>';
}

function renderReport(report) {
  if (!report || report.empty) {
    summaryGrid.innerHTML = '<div class="metric"><span>Status</span><strong>No report yet</strong></div>';
    Object.values(sections).forEach((section) => {
      section.count.textContent = '0';
      section.list.innerHTML = '<p class="empty">Run an analysis first.</p>';
    });
    return;
  }

  currentReport = report;
  channelInput.value = report.channel_filter || channelInput.value;
  renderSummary(report);
  renderChart(report);
  renderBatches();
  const actionable = report.actionable_batches || report.clusters;
  renderSection('batch', actionable.filter((cluster) => cluster.bucket === 'batch'));
  renderSection('borderline', actionable.filter((cluster) => cluster.bucket === 'borderline'));
  renderSection('multipack', actionable.filter((cluster) => cluster.bucket === 'multipack'));
}

function renderChart(report) {
  const actionable = report.actionable_batches || report.clusters;
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
  const stationCount = Math.max(1, Math.floor(teamSize / 2));
  const adjustedMinutes = currentReport.summary.estimated_minutes / stationCount;
  teamForecast.textContent = `${teamSize} team member${teamSize === 1 ? '' : 's'} · ${stationCount} active station${stationCount === 1 ? '' : 's'} · ${minutes(adjustedMinutes)} estimated elapsed time`;
}

function findCluster(subBatchId) {
  const actionable = currentReport?.actionable_batches || currentReport?.clusters || [];
  return actionable.find((cluster) => cluster.sub_batch_id === subBatchId || cluster.signature === subBatchId);
}

async function startBatch(subBatchId) {
  const cluster = findCluster(subBatchId);
  if (!cluster) return;
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
  }
}

async function completeBatch(batchId) {
  try {
    const response = await handleAuthResponse(await fetch(`/api/batches/${encodeURIComponent(batchId)}/complete`, { method: 'POST' }));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to complete batch');
    await loadBatches();
    showToast(`Batch complete. Tag cleanup: ${result.batch.cleanup_status}`);
  } catch (error) {
    showToast(error.message);
  }
}

async function cancelBatch(batchId) {
  try {
    const response = await handleAuthResponse(await fetch(`/api/batches/${encodeURIComponent(batchId)}/cancel`, { method: 'POST' }));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to cancel batch');
    await loadBatches();
    showToast(`Batch canceled. Tag cleanup: ${result.batch.cleanup_status}`);
  } catch (error) {
    showToast(error.message);
  }
}

async function pauseBatch(batchId) {
  try {
    const response = await handleAuthResponse(await fetch(`/api/batches/${encodeURIComponent(batchId)}/pause`, { method: 'POST' }));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to pause batch');
    await loadBatches();
    showToast(`Batch paused: ${result.batch.tag_name}`);
  } catch (error) {
    showToast(error.message);
  }
}

async function resumeBatch(batchId) {
  try {
    const response = await handleAuthResponse(await fetch(`/api/batches/${encodeURIComponent(batchId)}/resume`, { method: 'POST' }));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to resume batch');
    await loadBatches();
    showToast(`Batch resumed: ${result.batch.tag_name}`);
  } catch (error) {
    showToast(error.message);
  }
}

async function loadBatches() {
  const response = await handleAuthResponse(await fetch('/api/batches'));
  batchState = await response.json();
  if (currentReport) renderSummary(currentReport);
  renderBatches();
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
            <a class="open-veeqo" href="${escapeHtml(veeqoUrlForTag(batch.tag_name, batch.tag_id || ''))}" data-tag-name="${escapeHtml(batch.tag_name)}" data-tag-id="${escapeHtml(batch.tag_id || '')}">Open Veeqo</a>
          </div>
          <p>Started ${new Date(batch.started_at).toLocaleTimeString()}</p>
        </div>
        <div class="cell"><span>Orders</span><strong>${batch.order_count}</strong></div>
        <div class="cell"><span>Carrier</span><strong>${escapeHtml(batch.carrier_label || 'Unknown')}</strong></div>
        <div class="cell"><span>Package</span><strong>${escapeHtml(batch.package)}</strong></div>
        <div class="cell"><span>Status</span><strong>${paused ? 'Paused' : 'Running'}</strong></div>
        <div class="batch-actions">
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
        <div class="cell"><span>Carrier</span><strong>${escapeHtml(batch.carrier_label || 'Unknown')}</strong></div>
        <div class="cell"><span>Duration</span><strong>${minutes((batch.duration_seconds || 0) / 60)}</strong></div>
        <div class="cell"><span>Rate</span><strong>${Number(batch.orders_per_minute || 0).toFixed(1)}/min</strong></div>
      </article>
    `).join('')
    : '<p class="empty">No completed batches yet.</p>';
}

async function loadLatest() {
  const response = await handleAuthResponse(await fetch('/api/latest-analysis'));
  const report = await response.json();
  await loadBatches();
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
  channelScanButton.disabled = true;
  channelScanButton.textContent = 'Checking...';
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
    channelScanButton.disabled = false;
    channelScanButton.textContent = 'Find Channels';
  }
}

async function refreshAnalysis({ demo = false } = {}) {
  refreshButton.disabled = true;
  demoButton.disabled = true;
  const activeButton = demo ? demoButton : refreshButton;
  activeButton.textContent = 'Analyzing...';
  try {
    const params = new URLSearchParams();
    if (demo) params.set('demo', '1');
    if (!demo && channelInput.value.trim()) params.set('channel', channelInput.value.trim());
    const response = await handleAuthResponse(await fetch(`/api/analyze?${params.toString()}`, { method: 'POST' }));
    const report = await response.json();
    if (!response.ok) throw new Error(report.error || 'Analyze failed');
    renderReport(report);
    if (!demo && Number(report.summary?.included_orders || 0) === 0) {
      showToast(`No included orders. Pulled ${report.orders_pulled || 0}; channel matched ${report.summary?.source_orders || 0}.`);
    } else {
      showToast(demo ? 'Demo analysis loaded.' : 'Read-only live analysis refreshed.');
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    refreshButton.disabled = false;
    demoButton.disabled = false;
    refreshButton.textContent = 'Live Re-analyze';
    demoButton.textContent = 'Demo Data';
  }
}

refreshButton.addEventListener('click', () => refreshAnalysis());
demoButton.addEventListener('click', () => refreshAnalysis({ demo: true }));
channelScanButton.addEventListener('click', scanChannels);
logoutButton.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});
teamSizeInput.addEventListener('input', renderTeamForecast);
document.addEventListener('click', (event) => {
  const startButton = event.target.closest('.start-batch');
  if (startButton) startBatch(startButton.dataset.subBatchId);

  const completeButton = event.target.closest('.complete-batch');
  if (completeButton) completeBatch(completeButton.dataset.batchId);

  const cancelButton = event.target.closest('.cancel-batch');
  if (cancelButton) cancelBatch(cancelButton.dataset.batchId);

  const pauseButton = event.target.closest('.pause-batch');
  if (pauseButton) pauseBatch(pauseButton.dataset.batchId);

  const resumeButton = event.target.closest('.resume-batch');
  if (resumeButton) resumeBatch(resumeButton.dataset.batchId);

  const copyButton = event.target.closest('.copy-tag');
  if (copyButton) {
    copyText(copyButton.dataset.tagName)
      .then(() => showToast(`Copied: ${copyButton.dataset.tagName}`))
      .catch(() => showToast('Could not copy tag.'));
  }

});
loadPortalConfig()
  .then(loadLatest)
  .catch((error) => showToast(error.message));
