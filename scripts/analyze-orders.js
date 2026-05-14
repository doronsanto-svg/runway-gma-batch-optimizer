import { parseAnalyzeArgs, runReadOnlyAnalysis } from '../src/analyzer.js';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--channel') {
      args.channel = argv[index + 1];
      index += 1;
    } else if (token === '--all-skus') {
      args.allSkus = true;
    } else if (token === '--threshold') {
      args.threshold = Number.parseInt(argv[index + 1], 10);
      index += 1;
    }
  }
  return args;
}

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

function printClusterSection(title, clusters) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));

  if (clusters.length === 0) {
    console.log('None right now.');
    return;
  }

  clusters.forEach((cluster, index) => {
    console.log(`${index + 1}. ${cluster.label}`);
    console.log(`   Orders: ${cluster.order_count} | Revenue: ${formatMoney(cluster.total_revenue)} | Est: ${formatMinutes(cluster.estimated_minutes)}`);
    console.log(`   Category: ${cluster.category} | Station: ${cluster.station} | Package: ${cluster.package}`);
    console.log(`   Signature: ${cluster.signature}`);
    console.log(`   Sample orders: ${cluster.order_numbers.slice(0, 8).join(', ')}`);
  });
}

async function main() {
  const args = parseAnalyzeArgs(process.argv.slice(2));
  console.log('Pulling Veeqo orders for read-only analysis...');
  const { payload, paths } = await runReadOnlyAnalysis(args);
  const clusters = payload.actionable_batches || payload.clusters;
  const { summary } = payload;

  console.log('\nSummary');
  console.log('-------');
  console.log(`Channel/store filter: ${payload.channel_filter}`);
  console.log(`SKU filter: ${payload.sku_filter}`);
  console.log(`All ready-to-ship orders pulled: ${payload.orders_pulled}`);
  console.log(`Ready-to-ship orders in channel/store: ${summary.source_orders}`);
  console.log(`Orders included in clusters: ${summary.included_orders}`);
  if (payload.sku_filter !== 'all SKUs, test mode') {
    console.log(`Skipped non-GMA orders: ${summary.skipped.non_gma_only}`);
    console.log(`Skipped mixed GMA/non-GMA orders: ${summary.skipped.mixed_gma_and_non_gma}`);
  }
  console.log(`Skipped orders with no usable items: ${summary.skipped.no_items}`);
  console.log(`Carrier sub-batch count: ${clusters.length}`);
  console.log(`Estimated total pack time at seed rates: ${formatMinutes(summary.estimated_minutes)}`);
  console.log(`Estimated revenue in included clusters: ${formatMoney(summary.total_revenue)}`);

  printClusterSection('Batch Candidates', clusters.filter((cluster) => cluster.bucket === 'batch'));
  printClusterSection('Borderline Clusters', clusters.filter((cluster) => cluster.bucket === 'borderline'));
  printClusterSection('Multipack Queue', clusters.filter((cluster) => cluster.bucket === 'multipack'));

  console.log(`\nSaved readable report: ${paths.latestMarkdownPath}`);
  console.log(`Saved web report data: ${paths.latestJsonPath}`);
  console.log('\nRead-only analysis complete. No Veeqo orders were changed.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
