import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function formatMoney(value) {
  return `$${value.toFixed(2)}`;
}

function formatMinutes(value) {
  if (value < 1) return '<1 min';
  if (value < 60) return `${Math.round(value)} min`;

  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function renderClusterSection(title, clusters) {
  const lines = [`## ${title}`, ''];

  if (clusters.length === 0) {
    lines.push('None right now.', '');
    return lines;
  }

  clusters.forEach((cluster, index) => {
    lines.push(`### ${index + 1}. ${cluster.label}`);
    lines.push('');
    lines.push(`- Orders: ${cluster.order_count}`);
    lines.push(`- Revenue: ${formatMoney(cluster.total_revenue)}`);
    lines.push(`- Estimated time: ${formatMinutes(cluster.estimated_minutes)}`);
    lines.push(`- Category: ${cluster.category}`);
    lines.push(`- Station: ${cluster.station}`);
    lines.push(`- Package: ${cluster.package}`);
    lines.push(`- Signature: \`${cluster.signature}\``);
    lines.push(`- Sample orders: ${cluster.order_numbers.slice(0, 12).join(', ')}`);
    lines.push('');
  });

  return lines;
}

export function buildReportPayload({ channelFilter, requireGmaSkus, status, threshold, orders, totalCount, totalPages, clusters, subBatches = null, summary, orderIssues = [], dataSource = 'live Veeqo' }) {
  return {
    generated_at: new Date().toISOString(),
    data_source: dataSource,
    channel_filter: channelFilter,
    status,
    sku_filter: requireGmaSkus ? 'GMA SKU list only' : 'all SKUs, test mode',
    threshold,
    orders_pulled: orders.length,
    veeqo_total_count: totalCount || null,
    veeqo_total_pages: totalPages || null,
    summary,
    order_issues: orderIssues,
    clusters,
    actionable_batches: subBatches || clusters
  };
}

export function writeReports(payload) {
  const reportDir = resolve(process.cwd(), 'reports');
  mkdirSync(reportDir, { recursive: true });

  const lines = [
    '# Veeqo Read-Only Batch Analysis',
    '',
    `Generated: ${payload.generated_at}`,
    '',
    '## Summary',
    '',
    `- Channel/store filter: ${payload.channel_filter}`,
    `- Data source: ${payload.data_source}`,
    `- Veeqo status: ${payload.status}`,
    `- SKU filter: ${payload.sku_filter}`,
    `- Threshold: ${payload.threshold}`,
    `- All ready-to-ship orders pulled: ${payload.orders_pulled}`,
    `- Veeqo reported total: ${payload.veeqo_total_count || 'unknown'}`,
    `- Veeqo reported pages: ${payload.veeqo_total_pages || 'unknown'}`,
    `- Ready-to-ship orders in channel/store: ${payload.summary.source_orders}`,
    `- Held orders excluded from batches: ${payload.summary.held_orders || 0}`,
    `- Batchable orders after holds: ${payload.summary.batchable_orders ?? payload.summary.included_orders}`,
    `- Orders included in clusters: ${payload.summary.included_orders}`,
    `- Skipped non-GMA orders: ${payload.summary.skipped.non_gma_only}`,
    `- Skipped mixed GMA/non-GMA orders: ${payload.summary.skipped.mixed_gma_and_non_gma}`,
    `- Skipped orders with no usable items: ${payload.summary.skipped.no_items}`,
    `- Parent cluster count: ${payload.clusters.length}`,
    `- Carrier sub-batch count: ${payload.actionable_batches.length}`,
    `- Estimated total pack time at seed rates: ${formatMinutes(payload.summary.estimated_minutes)}`,
    `- Estimated revenue in included clusters: ${formatMoney(payload.summary.total_revenue)}`,
    '',
    ...renderClusterSection('Batch Candidates', payload.actionable_batches.filter((cluster) => cluster.bucket === 'batch')),
    ...renderClusterSection('Borderline Clusters', payload.actionable_batches.filter((cluster) => cluster.bucket === 'borderline')),
    ...renderClusterSection('Multipack Queue', payload.actionable_batches.filter((cluster) => cluster.bucket === 'multipack')),
    'No Veeqo orders were changed.',
    ''
  ];

  const latestMarkdownPath = resolve(reportDir, 'latest-analysis.md');
  const latestJsonPath = resolve(reportDir, 'latest-analysis.json');

  writeFileSync(latestMarkdownPath, lines.join('\n'));
  writeFileSync(latestJsonPath, JSON.stringify(payload, null, 2));

  return { latestMarkdownPath, latestJsonPath };
}

export function readLatestReport() {
  const latestJsonPath = resolve(process.cwd(), 'reports', 'latest-analysis.json');
  if (!existsSync(latestJsonPath)) return null;
  return JSON.parse(readFileSync(latestJsonPath, 'utf8'));
}
