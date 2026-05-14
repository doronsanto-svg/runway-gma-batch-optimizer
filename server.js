import { createServer } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { loadEnv } from './src/env.js';
import { readLatestReport } from './src/report.js';
import { runReadOnlyAnalysis } from './src/analyzer.js';
import { cancelBatchRecord, createBatchRecord, completeBatchRecord, listBatches, readBatchStore, updateActiveBatchRecord } from './src/batch-store.js';
import { requireEnv } from './src/env.js';
import { getOrderChannelName, VeeqoClient } from './src/veeqo.js';

loadEnv();

const root = process.cwd();
const publicDir = resolve(root, 'public');
const port = Number.parseInt(process.env.PORT || '3000', 10);
const sessions = new Map();
const sessionTtlMs = 1000 * 60 * 60 * 12;

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
    <link rel="stylesheet" href="/style.css?v=20260513-3">
  </head>
  <body class="login-page">
    <main class="login-shell">
      <form id="loginForm" class="login-panel">
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

function findStoredBatch(batchId) {
  const store = readBatchStore();
  return [...store.active, ...store.completed, ...store.canceled].find((batch) => batch.id === batchId);
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
      sendJson(response, 200, readLatestReport() || { empty: true });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/batches') {
      sendJson(response, 200, listBatches());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/batches/completed') {
      sendJson(response, 200, { completed: readBatchStore().completed });
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
        channel: url.searchParams.get('channel') || undefined
      });
      sendJson(response, 200, payload);
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

      const live = report.data_source !== 'demo test data';
      const tagName = live
        ? `BATCH-NOW-${tagSafe(subBatch.carrier)}-${Date.now()}`
        : `DEMO-BATCH-${tagSafe(subBatch.carrier)}-${Date.now()}`;
      let tagId = null;
      const existing = readBatchStore().active.find((batch) => batch.sub_batch_id === subBatch.sub_batch_id);
      if (existing) {
        sendJson(response, 200, { batch: existing });
        return;
      }

      if (live) {
        const client = makeVeeqoClient();
        const tag = await client.findOrCreateTag({ name: tagName, colour: '#f5df9e' });
        tagId = tag.id;
        await client.tagOrders({ orderIds: subBatch.order_ids, tagIds: [tag.id] });
      }

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
        package: subBatch.package,
        order_count: subBatch.order_count,
        total_revenue: subBatch.total_revenue,
        estimated_minutes: subBatch.estimated_minutes,
        order_ids: subBatch.order_ids,
        order_numbers: subBatch.order_numbers,
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
