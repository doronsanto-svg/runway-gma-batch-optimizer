import { createServer } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { loadEnv } from './src/env.js';
import { readLatestReport } from './src/report.js';
import { applyPackageStateToReport, runReadOnlyAnalysis } from './src/analyzer.js';
import { cancelBatchRecord, createBatchRecord, completeBatchRecord, listBatches, readBatchStore, reconcileActiveBatches, reopenCompletedBatchRecord, updateActiveBatchRecord, updateStoredBatchRecord } from './src/batch-store.js';
import { requireEnv } from './src/env.js';
import { getOrderChannelName, VeeqoClient } from './src/veeqo.js';
import { buildPrepRows, packageSuggestionForRow, prepSummary, readPrepStore, setPackageOverride, setPreparedStatus } from './src/prep-store.js';
import { analyzeOrderIssues } from './src/order-issues.js';
import { packageOrdersForBatch } from './src/packaging-calculator.js';
import { readPackagingSettings, writePackagingSettings } from './src/packaging-store.js';
import { buildSalesReport } from './src/sales-report.js';

loadEnv();

const root = process.cwd();
const publicDir = resolve(root, 'public');
const port = Number.parseInt(process.env.PORT || '3000', 10);
const sessions = new Map();
const sessionTtlMs = 1000 * 60 * 60 * 12;
const quickBatchChunkSize = 50;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function tagSafe(value) {
  return String(value || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'UNKNOWN';
}

function portalConfig() {
  return {
    username: process.env.PORTAL_USERNAME || '',
    password: process.env.PORTAL_PASSWORD || '',
    sessionSecret: process.env.PORTAL_SESSION_SECRET || process.env.PORTAL_PASSWORD || 'local-dev-session',
    veeqoOrdersUrl: process.env.VEEQO_ORDERS_URL || 'https://app.veeqo.com/orders',
    veeqoTagFilterUrlTemplate: process.env.VEEQO_TAG_FILTER_URL_TEMPLATE || '',
    veeqoOrderUrlTemplate: process.env.VEEQO_ORDER_URL_TEMPLATE || '',
    shopifyOrderUrlTemplate: process.env.SHOPIFY_ORDER_URL_TEMPLATE || ''
  };
}

function authEnabled() {
  const config = portalConfig();
  return Boolean(config.username && config.password);
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';')
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .map((cookie) => {
      const separator = cookie.indexOf('=');
      if (separator === -1) return [cookie, ''];
      return [cookie.slice(0, separator), decodeURIComponent(cookie.slice(separator + 1))];
    }));
}

function signSessionToken(token) {
  return createHmac('sha256', portalConfig().sessionSecret).update(token).digest('hex');
}

function makeSessionCookie(token, request) {
  const secure = request.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  return [
    `batch_optimizer_session=${encodeURIComponent(`${token}.${signSessionToken(token)}`)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(sessionTtlMs / 1000)}`,
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

function clearSessionCookie() {
  return 'batch_optimizer_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getSession(request) {
  if (!authEnabled()) return { user: 'local' };
  const cookie = parseCookies(request.headers.cookie || '').batch_optimizer_session;
  if (!cookie) return null;

  const [token, signature] = cookie.split('.');
  if (!token || !signature || !safeCompare(signature, signSessionToken(token))) return null;

  const session = sessions.get(token);
  if (!session || session.expires_at < Date.now()) {
    sessions.delete(token);
    return null;
  }

  return session;
}

function loginHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Runway GMA Batch Optimizer Login</title>
    <link rel="icon" type="image/png" href="/odi-icon.png">
    <link rel="apple-touch-icon" href="/odi-icon.png">
    <link rel="stylesheet" href="/style.css?v=20260513-3">
  </head>
  <body class="login-page">
    <main class="login-shell">
      <form id="loginForm" class="login-panel">
        <img class="app-logo login-logo" src="/odi-icon.png" alt="ODI">
        <p class="eyebrow">Private Portal</p>
        <h1>Runway GMA Batch Optimizer</h1>
        <label for="usernameInput">Username</label>
        <input id="usernameInput" name="username" autocomplete="username" required>
        <label for="passwordInput">Password</label>
        <input id="passwordInput" name="password" type="password" autocomplete="current-password" required>
        <button type="submit">Log In</button>
        <p id="loginError" class="login-error" hidden>Login failed.</p>
      </form>
    </main>
    <script>
      const form = document.querySelector('#loginForm');
      const error = document.querySelector('#loginError');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        error.hidden = true;
        const data = new FormData(form);
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: data.get('username') || '',
            password: data.get('password') || ''
          })
        });
        if (response.ok) {
          window.location.href = new URLSearchParams(window.location.search).get('next') || '/';
        } else {
          error.hidden = false;
        }
      });
    </script>
  </body>
</html>`;
}

function makeVeeqoClient() {
  return new VeeqoClient({
    apiKey: requireEnv('VEEQO_API_KEY'),
    baseUrl: process.env.VEEQO_BASE_URL || 'https://api.veeqo.com'
  });
}

function findActionableBatch(report, subBatchId) {
  return (report?.actionable_batches || report?.clusters || []).find((batch) => batch.sub_batch_id === subBatchId || batch.signature === subBatchId);
}

function unavailableOrderIds(store = readBatchStore()) {
  return new Set([...(store.active || []), ...(store.completed || [])].flatMap((batch) => batch.order_ids || []));
}

function completedOrderIds(store = readBatchStore()) {
  return new Set((store.completed || []).flatMap((batch) => batch.order_ids || []));
}

function uniqueValues(values = []) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ''))];
}

function chunkArray(values = [], size = quickBatchChunkSize) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function groupByPackageOrders(packageOrders = []) {
  const groups = new Map();
  for (const order of packageOrders) {
    const key = order.package || 'Package Review';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(order);
  }
  return groups;
}

async function pushPreparedPackages({ client, live, preparedOrders }) {
  if (!live) return;
  for (const order of preparedOrders) {
    await client.updateAllocationPackage({
      allocationId: order.allocation_id,
      allocationPackage: order.allocation_package
    });
  }
}

async function prepareBatchPackages({ client, live, packageOrders, settings = readPackagingSettings(), allowPartial = false }) {
  if (!Array.isArray(packageOrders) || !packageOrders.length) {
    throw new Error('Package Review required: run Live Re-analyze so orders include allocation/package details.');
  }
  const result = packageOrdersForBatch(packageOrders, settings);
  if (result.failed.length && (!allowPartial || !result.ok.length)) {
    const sample = result.failed.slice(0, 5).map((order) => `${order.order_number || order.order_id}: ${order.reason}`).join('; ');
    throw new Error(`Package Review required for ${result.failed.length} order(s). ${sample}`);
  }

  await pushPreparedPackages({ client, live, preparedOrders: result.ok });

  return allowPartial ? result : result.ok;
}

function sourceBatchesFromRequest(body = {}, targetCount, unavailableIds) {
  const orderIds = uniqueValues(Array.isArray(body.order_ids) ? body.order_ids : [])
    .filter((id) => !unavailableIds.has(id));
  const sourceBatches = Array.isArray(body.source_batches) ? body.source_batches : [];
  if (!orderIds.length || !sourceBatches.length) return null;

  const invalidSource = sourceBatches.some((batch) => Number(batch.order_count || 0) !== targetCount);
  if (invalidSource) return null;

  const requestedOrderIds = new Set(orderIds);
  const sourceOrderIds = new Set(sourceBatches.flatMap((batch) => batch.order_ids || []));
  if (orderIds.some((id) => !sourceOrderIds.has(id))) return null;

  return {
    orderIds,
    orderNumbers: uniqueValues(Array.isArray(body.order_numbers) ? body.order_numbers : []),
    sourceBatches: sourceBatches.map((batch) => ({
      ...batch,
      order_ids: (batch.order_ids || []).filter((id) => requestedOrderIds.has(id)),
      package_orders: (batch.package_orders || []).filter((order) => requestedOrderIds.has(order.order_id))
    })).filter((batch) => (batch.order_ids || []).length)
  };
}

function sourceBatchesFromReport(report, targetCount, unavailableIds) {
  const sourceBatches = (report?.actionable_batches || report?.clusters || [])
    .filter((batch) => Number(batch.order_count || 0) === targetCount);
  const orderNumberById = new Map();
  sourceBatches.forEach((batch) => {
    (batch.order_ids || []).forEach((id, index) => {
      orderNumberById.set(id, (batch.order_numbers || [])[index]);
    });
  });
  const orderIds = uniqueValues(sourceBatches.flatMap((batch) => batch.order_ids || []))
    .filter((id) => !unavailableIds.has(id));
  return {
    orderIds,
    orderNumbers: orderIds.map((id) => orderNumberById.get(id)).filter(Boolean),
    sourceBatches: sourceBatches
      .filter((batch) => (batch.order_ids || []).some((id) => orderIds.includes(id)))
      .map((batch) => ({
        ...batch,
        package_orders: (batch.package_orders || []).filter((order) => orderIds.includes(order.order_id))
      }))
  };
}

function buildCountBatchFromReport(report, orderCount, store = readBatchStore(), body = {}, packageOrders = []) {
  const targetCount = Number(orderCount || 0);
  if (![1, 2, 3].includes(targetCount)) return null;

  const baseSubBatchId = `COUNT-${targetCount}`;

  const unavailableIds = unavailableOrderIds(store);
  const source = sourceBatchesFromRequest(body, targetCount, unavailableIds)
    || sourceBatchesFromReport(report, targetCount, unavailableIds);
  const orderIds = source.orderIds;
  const orderNumbers = source.orderNumbers;
  const sourceBatches = source.sourceBatches;
  const includedSources = sourceBatches.filter((batch) => (batch.order_ids || []).some((id) => orderIds.includes(id)));

  if (!includedSources.length || !orderIds.length) {
    return { baseSubBatchId, batches: [] };
  }

  const carrierLabels = uniqueValues(includedSources.map((batch) => batch.carrier_label || 'Unknown'));
  const station = uniqueValues(includedSources.map((batch) => batch.station || '').filter(Boolean)).join(' / ') || 'Mixed';
  const orderNumberById = new Map();
  orderIds.forEach((id, index) => {
    orderNumberById.set(id, orderNumbers[index]);
  });
  const packageOrderById = new Map(packageOrders.map((order) => [order.order_id, order]));
  const packageGroups = packageOrders.length
    ? [...groupByPackageOrders(packageOrders).entries()]
    : [['Mixed', orderIds.map((id) => ({ order_id: id }))]];
  const chunks = packageGroups.flatMap(([packageName, orders]) => (
    chunkArray(orders.map((order) => order.order_id), quickBatchChunkSize).map((chunk) => ({ packageName, chunk }))
  ));
  return {
    baseSubBatchId,
    batches: chunks.map(({ packageName, chunk }, index) => {
      const chunkSet = new Set(chunk);
      const chunkSources = includedSources.map((batch) => ({
        ...batch,
        order_ids: (batch.order_ids || []).filter((id) => chunkSet.has(id))
      })).filter((batch) => (batch.order_ids || []).length);
      const part = index + 1;
      const subBatchId = `${baseSubBatchId}-${part}`;
      return {
        sub_batch_id: subBatchId,
        signature: subBatchId,
        carrier: 'mixed',
        carrier_label: carrierLabels.length === 1 ? carrierLabels[0] : 'Mixed',
        label: `${targetCount}-Order Quick Batch ${part}/${chunks.length}`,
        category: 'quick_count',
        station,
        package: packageName,
        order_count: chunk.length,
        source_batch_count: chunkSources.length,
        source_order_count: targetCount,
        total_revenue: chunkSources.reduce((sum, batch) => sum + Number(batch.total_revenue || 0), 0),
        estimated_minutes: chunkSources.reduce((sum, batch) => sum + Number(batch.estimated_minutes || 0), 0),
        order_ids: chunk,
        order_numbers: chunk.map((id) => orderNumberById.get(id)).filter(Boolean),
        items: [],
        package_orders: chunk.map((id) => packageOrderById.get(id)).filter(Boolean),
        source_batches: chunkSources.map((batch) => ({
          sub_batch_id: batch.sub_batch_id,
          signature: batch.signature,
          label: batch.label,
          order_count: (batch.order_ids || []).length,
          order_ids: batch.order_ids || [],
          items: batch.items || [],
          package_orders: (batch.package_orders || []).filter((order) => chunkSet.has(order.order_id))
        }))
      };
    })
  };
}

function quickPackageOrders(report, body, store = readBatchStore()) {
  const targetCount = Number(body.order_count || 0);
  const unavailableIds = unavailableOrderIds(store);
  const source = sourceBatchesFromRequest(body, targetCount, unavailableIds)
    || sourceBatchesFromReport(report, targetCount, unavailableIds);
  const orderIdSet = new Set(source.orderIds || []);
  return (source.sourceBatches || [])
    .flatMap((batch) => batch.package_orders || [])
    .filter((order) => orderIdSet.has(order.order_id));
}

function findStoredBatch(batchId) {
  const store = readBatchStore();
  return [...store.active, ...store.completed, ...store.canceled].find((batch) => batch.id === batchId);
}

function latestPrepPayload() {
  const report = readLatestReport() || { clusters: [] };
  const store = readPrepStore();
  const rows = buildPrepRows(report.clusters || [], store);
  return { state: store, rows, summary: prepSummary(rows) };
}

function veeqoUrlForBatch(batch) {
  const config = portalConfig();
  if (!batch?.tag_id) return config.veeqoOrdersUrl;
  if (config.veeqoTagFilterUrlTemplate) {
    return config.veeqoTagFilterUrlTemplate
      .replaceAll('{tag_id}', encodeURIComponent(batch.tag_id))
      .replaceAll('{tag}', encodeURIComponent(batch.tag_name || ''))
      .replaceAll('{tag_raw}', batch.tag_name || '');
  }
  return `${config.veeqoOrdersUrl}?tags[any_of]=${encodeURIComponent(batch.tag_id)}`;
}

function issueConfig() {
  return {
    veeqoOrdersUrl: process.env.VEEQO_ORDERS_URL || 'https://app.veeqo.com/orders',
    veeqoOrderUrlTemplate: process.env.VEEQO_ORDER_URL_TEMPLATE || '',
    shopifyOrderUrlTemplate: process.env.SHOPIFY_ORDER_URL_TEMPLATE || ''
  };
}

function elapsedPauseSeconds(batch, now = new Date()) {
  const savedPauseSeconds = Number(batch.pause_seconds || 0);
  if (batch.status === 'paused' && batch.paused_at) {
    return savedPauseSeconds + Math.max(0, Math.round((now - new Date(batch.paused_at)) / 1000));
  }
  return savedPauseSeconds;
}

function safePublicPath(pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const normalized = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  return join(publicDir, normalized);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === 'GET' && url.pathname === '/login') {
      sendHtml(response, 200, loginHtml());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/style.css') {
      const data = await readFile(join(publicDir, 'style.css'));
      response.writeHead(200, {
        'Content-Type': contentTypes['.css'],
        'Cache-Control': 'no-store'
      });
      response.end(data);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/login') {
      const body = await readJsonBody(request);
      const config = portalConfig();
      if (!authEnabled() || (safeCompare(body.username || '', config.username) && safeCompare(body.password || '', config.password))) {
        const token = randomBytes(24).toString('hex');
        sessions.set(token, { user: body.username || 'local', expires_at: Date.now() + sessionTtlMs });
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': makeSessionCookie(token, request)
        });
        response.end(JSON.stringify({ ok: true }));
      } else {
        sendJson(response, 401, { error: 'Invalid login.' });
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/healthz') {
      sendJson(response, 200, { ok: true });
      return;
    }

    const session = getSession(request);
    if (!session) {
      if (url.pathname.startsWith('/api/')) {
        sendJson(response, 401, { error: 'Login required.' });
      } else {
        response.writeHead(302, { Location: `/login?next=${encodeURIComponent(url.pathname + url.search)}` });
        response.end();
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/logout') {
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': clearSessionCookie()
      });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/session') {
      const config = portalConfig();
      sendJson(response, 200, {
        user: session.user,
        auth_enabled: authEnabled(),
        default_channel_filter: process.env.VEEQO_CHANNEL_FILTER || 'Runway by Christian Siriano',
        analyze_status: process.env.VEEQO_ANALYZE_STATUS || process.env.VEEQO_API_CHECK_STATUS || 'awaiting_fulfillment',
        require_gma_skus: process.env.REQUIRE_GMA_SKUS !== 'false',
        veeqo_orders_url: config.veeqoOrdersUrl,
        veeqo_tag_filter_url_template: config.veeqoTagFilterUrlTemplate,
        veeqo_order_url_template: config.veeqoOrderUrlTemplate,
        shopify_order_url_template: config.shopifyOrderUrlTemplate
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/latest-analysis') {
      sendJson(response, 200, applyPackageStateToReport(readLatestReport()) || { empty: true });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/batches') {
      const report = applyPackageStateToReport(readLatestReport());
      sendJson(response, 200, report ? reconcileActiveBatches(report) : listBatches());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/batches/completed') {
      sendJson(response, 200, { completed: readBatchStore().completed });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/prep') {
      sendJson(response, 200, latestPrepPayload());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/packaging') {
      sendJson(response, 200, readPackagingSettings());
      return;
    }

    if (request.method === 'PATCH' && url.pathname === '/api/packaging') {
      const body = await readJsonBody(request);
      sendJson(response, 200, writePackagingSettings(body));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/channels') {
      const status = process.env.VEEQO_ANALYZE_STATUS || process.env.VEEQO_API_CHECK_STATUS || 'awaiting_fulfillment';
      const pageSize = Number.parseInt(process.env.VEEQO_ANALYZE_PAGE_SIZE || '100', 10);
      const result = await makeVeeqoClient().listAllOrders({ status, pageSize });
      const counts = new Map();

      for (const order of result.orders) {
        const name = getOrderChannelName(order) || 'Unknown';
        counts.set(name, (counts.get(name) || 0) + 1);
      }

      sendJson(response, 200, {
        status,
        orders_pulled: result.orders.length,
        channels: [...counts.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/sales-report') {
      const pageSize = Number.parseInt(process.env.VEEQO_SALES_PAGE_SIZE || process.env.VEEQO_ANALYZE_PAGE_SIZE || '100', 10);
      const maxPages = Number.parseInt(url.searchParams.get('pages') || process.env.VEEQO_SALES_MAX_PAGES || '5', 10);
      const maxMs = Number.parseInt(process.env.VEEQO_SALES_MAX_MS || '20000', 10);
      const result = await makeVeeqoClient().listAllOrders({ status: '', pageSize, maxPages, maxMs });
      sendJson(response, 200, buildSalesReport({
        orders: result.orders,
        channelFilter: url.searchParams.get('channel') || process.env.VEEQO_CHANNEL_FILTER || 'Runway by Christian Siriano',
        completedOrderIds: completedOrderIds(),
        dataSource: `Veeqo order history (${result.pagesPulled || 0} page${result.pagesPulled === 1 ? '' : 's'})`,
        totalCount: result.totalCount,
        totalPages: result.totalPages,
        pagesPulled: result.pagesPulled || 0
      }));
      return;
    }

    const issueRecheckMatch = url.pathname.match(/^\/api\/issues\/([^/]+)\/recheck$/);
    if (request.method === 'POST' && issueRecheckMatch) {
      const orderId = decodeURIComponent(issueRecheckMatch[1]);
      const order = await makeVeeqoClient().getOrder(orderId);
      const issue = analyzeOrderIssues(order, issueConfig());
      sendJson(response, 200, {
        order_id: order?.id || orderId,
        order_number: order?.number || String(orderId),
        status: issue?.hold ? 'held' : issue ? 'warning' : 'cleared',
        issue
      });
      return;
    }

    const veeqoMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/veeqo$/);
    if (request.method === 'GET' && veeqoMatch) {
      const batchId = decodeURIComponent(veeqoMatch[1]);
      const batch = findStoredBatch(batchId);
      if (!batch) {
        sendJson(response, 404, { error: 'Batch not found.' });
        return;
      }

      response.writeHead(302, { Location: veeqoUrlForBatch(batch) });
      response.end();
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/analyze') {
      const { payload } = await runReadOnlyAnalysis({
        demo: url.searchParams.get('demo') === '1',
        channel: url.searchParams.get('channel') || undefined,
        refreshCarriers: url.searchParams.get('refresh_carriers') === '1'
      });
      sendJson(response, 200, payload);
      return;
    }

    if (request.method === 'PATCH' && url.pathname === '/api/prep/package') {
      const body = await readJsonBody(request);
      if (!body.signature) {
        sendJson(response, 400, { error: 'signature is required.' });
        return;
      }
      setPackageOverride({
        signature: body.signature,
        label: body.label || '',
        packageName: body.package || '',
        category: body.category || '',
        items: Array.isArray(body.items) ? body.items : []
      });
      sendJson(response, 200, latestPrepPayload());
      return;
    }

    if (request.method === 'PATCH' && url.pathname === '/api/prep/status') {
      const body = await readJsonBody(request);
      if (!body.signature || !body.package) {
        sendJson(response, 400, { error: 'signature and package are required.' });
        return;
      }
      setPreparedStatus({
        signature: body.signature,
        label: body.label || '',
        packageName: body.package,
        prepared: body.prepared
      });
      sendJson(response, 200, latestPrepPayload());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/batches') {
      const body = await readJsonBody(request);
      const report = readLatestReport();
      const subBatch = findActionableBatch(report, body.sub_batch_id);
      if (!subBatch) {
        sendJson(response, 404, { error: 'Sub-batch not found in latest analysis.' });
        return;
      }
      const packageSuggestion = packageSuggestionForRow(subBatch, readPrepStore());
      const packageName = packageSuggestion.packageName || subBatch.package;

      const live = report?.data_source !== 'demo test data';
      const tagName = live
        ? `BATCH-NOW-${tagSafe(subBatch.carrier)}-${Date.now()}`
        : `DEMO-BATCH-${tagSafe(subBatch.carrier)}-${Date.now()}`;
      let tagId = null;
      const existing = readBatchStore().active.find((batch) => batch.sub_batch_id === subBatch.sub_batch_id);
      if (existing) {
        sendJson(response, 200, { batch: existing });
        return;
      }

      const client = live ? makeVeeqoClient() : null;
      const preparedOrders = await prepareBatchPackages({
        client,
        live,
        packageOrders: subBatch.package_orders || []
      });
      if (live) {
        const tag = await client.findOrCreateTag({ name: tagName, colour: '#f5df9e' });
        tagId = tag.id;
        await client.tagOrders({ orderIds: subBatch.order_ids, tagIds: [tag.id] });
      }
      const packageNames = uniqueValues(preparedOrders.map((order) => order.package));

      const batch = createBatchRecord({
        mode: live ? 'live' : 'demo',
        status: 'active',
        sub_batch_id: subBatch.sub_batch_id,
        signature: subBatch.signature,
        carrier: subBatch.carrier,
        carrier_label: subBatch.carrier_label,
        label: subBatch.label,
        category: subBatch.category,
        station: subBatch.station,
        package: packageNames.length === 1 ? packageNames[0] : packageName,
        order_count: subBatch.order_count,
        total_revenue: subBatch.total_revenue,
        estimated_minutes: subBatch.estimated_minutes,
        order_ids: subBatch.order_ids,
        order_numbers: subBatch.order_numbers,
        items: subBatch.items || [],
        package_orders: preparedOrders,
        tag_name: tagName,
        tag_id: tagId,
        started_at: new Date().toISOString(),
        pause_seconds: 0,
        paused_at: null,
        cleanup_status: live ? 'pending' : 'not_needed'
      });

      sendJson(response, 200, { batch });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/batches/by-count') {
      const body = await readJsonBody(request);
      const report = readLatestReport();
      const store = readBatchStore();
      const live = report?.data_source !== 'demo test data';
      const client = live ? makeVeeqoClient() : null;
      const requestedPackageOrders = quickPackageOrders(report, body, store);
      const packageResult = await prepareBatchPackages({
        client,
        live,
        packageOrders: requestedPackageOrders,
        allowPartial: true
      });
      const quickBatch = buildCountBatchFromReport(report, body.order_count, store, body, packageResult.ok);
      if (!quickBatch) {
        sendJson(response, 400, { error: 'Order count must be 1, 2, or 3.' });
        return;
      }
      if (!quickBatch.batches?.length) {
        sendJson(response, 404, { error: `No current ${body.order_count}-order batches are available to tag.` });
        return;
      }

      const createdBatches = [];
      const timestamp = Date.now();

      for (let index = 0; index < quickBatch.batches.length; index += 1) {
        const quickPart = quickBatch.batches[index];
        const part = index + 1;
        const tagName = live
          ? `BATCH-COUNT-${tagSafe(body.order_count)}-${part}-${timestamp}`
          : `DEMO-COUNT-${tagSafe(body.order_count)}-${part}-${timestamp}`;
        let tagId = null;

        if (live) {
          const tag = await client.findOrCreateTag({ name: tagName, colour: '#f5df9e' });
          tagId = tag.id;
          await client.tagOrders({ orderIds: quickPart.order_ids, tagIds: [tag.id] });
        }

        createdBatches.push(createBatchRecord({
          mode: live ? 'live' : 'demo',
          status: 'active',
          ...quickPart,
          tag_name: tagName,
          tag_id: tagId,
          started_at: new Date().toISOString(),
          pause_seconds: 0,
          paused_at: null,
          cleanup_status: live ? 'pending' : 'not_needed'
        }));
      }

      sendJson(response, 200, {
        batch: createdBatches[0],
        batches: createdBatches,
        package_review_count: packageResult.failed.length,
        package_review_orders: packageResult.failed.slice(0, 10).map((order) => ({
          order_id: order.order_id,
          order_number: order.order_number,
          reason: order.reason
        }))
      });
      return;
    }

    const completeMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/complete$/);
    if (request.method === 'POST' && completeMatch) {
      const batchId = decodeURIComponent(completeMatch[1]);
      const store = readBatchStore();
      const active = store.active.find((batch) => batch.id === batchId);
      if (!active) {
        sendJson(response, 404, { error: 'Active batch not found.' });
        return;
      }

      let cleanupStatus = active.cleanup_status;
      if (active.mode === 'live' && active.tag_id) {
        const client = makeVeeqoClient();
        await client.untagOrders({ orderIds: active.order_ids, tagIds: [active.tag_id] });
        cleanupStatus = 'removed';
      }

      const completedAt = new Date().toISOString();
      const pauseSeconds = elapsedPauseSeconds(active, new Date(completedAt));
      const durationSeconds = Math.max(1, Math.round((new Date(completedAt) - new Date(active.started_at)) / 1000) - pauseSeconds);
      const completed = completeBatchRecord(batchId, {
        status: 'completed',
        completed_at: completedAt,
        duration_seconds: durationSeconds,
        pause_seconds: pauseSeconds,
        paused_at: null,
        orders_per_minute: active.order_count / (durationSeconds / 60),
        cleanup_status: cleanupStatus
      });

      sendJson(response, 200, { batch: completed });
      return;
    }

    const reopenMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/reopen$/);
    if (request.method === 'POST' && reopenMatch) {
      const batchId = decodeURIComponent(reopenMatch[1]);
      const store = readBatchStore();
      const completed = store.completed.find((batch) => batch.id === batchId || batch.tag_name === batchId || String(batch.tag_id || '') === batchId);
      if (!completed) {
        sendJson(response, 404, { error: 'Completed batch not found.' });
        return;
      }

      let cleanupStatus = completed.cleanup_status;
      if (completed.mode === 'live' && completed.tag_id) {
        const client = makeVeeqoClient();
        await client.tagOrders({ orderIds: completed.order_ids, tagIds: [completed.tag_id] });
        cleanupStatus = 'restored';
      }

      const reopened = reopenCompletedBatchRecord(batchId, {
        status: 'paused',
        paused_at: new Date().toISOString(),
        cleanup_status: cleanupStatus
      });
      sendJson(response, 200, { batch: reopened });
      return;
    }

    const labelCarrierMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/label-carrier$/);
    if (request.method === 'PATCH' && labelCarrierMatch) {
      const batchId = decodeURIComponent(labelCarrierMatch[1]);
      const body = await readJsonBody(request);
      const carrier = String(body.carrier || '').toUpperCase();
      if (carrier && !['USPS', 'UPS'].includes(carrier)) {
        sendJson(response, 400, { error: 'Carrier must be USPS or UPS.' });
        return;
      }
      const batch = updateStoredBatchRecord(batchId, { print_carrier: carrier });
      if (!batch) {
        sendJson(response, 404, { error: 'Batch not found.' });
        return;
      }
      sendJson(response, 200, { batch });
      return;
    }

    const pauseMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/pause$/);
    if (request.method === 'POST' && pauseMatch) {
      const batchId = decodeURIComponent(pauseMatch[1]);
      const active = readBatchStore().active.find((batch) => batch.id === batchId);
      if (!active) {
        sendJson(response, 404, { error: 'Active batch not found.' });
        return;
      }

      if (active.status === 'paused') {
        sendJson(response, 200, { batch: active });
        return;
      }

      const paused = updateActiveBatchRecord(batchId, {
        status: 'paused',
        paused_at: new Date().toISOString(),
        pause_seconds: Number(active.pause_seconds || 0)
      });

      sendJson(response, 200, { batch: paused });
      return;
    }

    const resumeMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/resume$/);
    if (request.method === 'POST' && resumeMatch) {
      const batchId = decodeURIComponent(resumeMatch[1]);
      const active = readBatchStore().active.find((batch) => batch.id === batchId);
      if (!active) {
        sendJson(response, 404, { error: 'Active batch not found.' });
        return;
      }

      const pauseSeconds = elapsedPauseSeconds(active);
      const resumed = updateActiveBatchRecord(batchId, {
        status: 'active',
        paused_at: null,
        pause_seconds: pauseSeconds
      });

      sendJson(response, 200, { batch: resumed });
      return;
    }

    const cancelMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/cancel$/);
    if (request.method === 'POST' && cancelMatch) {
      const batchId = decodeURIComponent(cancelMatch[1]);
      const store = readBatchStore();
      const active = store.active.find((batch) => batch.id === batchId);
      if (!active) {
        sendJson(response, 404, { error: 'Active batch not found.' });
        return;
      }

      let cleanupStatus = active.cleanup_status;
      if (active.mode === 'live' && active.tag_id) {
        const client = makeVeeqoClient();
        await client.untagOrders({ orderIds: active.order_ids, tagIds: [active.tag_id] });
        cleanupStatus = 'removed';
      }

      const canceled = cancelBatchRecord(batchId, {
        canceled_at: new Date().toISOString(),
        cleanup_status: cleanupStatus
      });

      sendJson(response, 200, { batch: canceled });
      return;
    }

    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    const filePath = safePublicPath(url.pathname);
    if (!filePath.startsWith(publicDir)) {
      sendJson(response, 403, { error: 'Forbidden' });
      return;
    }

    const data = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    response.end(data);
  } catch (error) {
    console.error(`[${request.method}] ${request.url}`, error);
    if (error.code === 'ENOENT') {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Batch Optimizer report available at http://localhost:${port}`);
});
