# Runway GMA Batch Optimizer

Local fulfillment tool for the Runway x GMA June 1, 2026 order surge.

## Current Phase

Phase 0: Veeqo API reality check.

The first script is read-only. It verifies:

- API authentication works.
- `/orders` accepts the current fulfillment status filter.
- order pagination headers are present.
- order line items contain usable SKU and quantity data.
- `/tags` can be listed.

It does not create tags, modify orders, or print anything.

## Local Setup

1. Copy `.env.example` to `.env`.
2. Put the real Veeqo API key in `.env`.
3. Run:

```bash
npm run check:veeqo
```

Keep `.env` private and do not paste the API key in chat.

`VEEQO_API_CHECK_PAGE_SIZE=5` only limits the first safety check to five orders. The production analyzer will paginate through all matching open orders.

Veeqo's UI label "Ready To Ship" maps to API status `awaiting_fulfillment`.

## Read-Only Analysis

Run:

```bash
npm run analyze
```

This pulls all `awaiting_fulfillment` orders, filters to GMA-only orders, clusters by exact SKU/quantity signature, and prints batch candidates, borderline clusters, and multipack clusters.

Orders with only non-GMA SKUs are skipped. Orders that mix GMA SKUs with non-GMA SKUs are also skipped for now so the tool never accidentally batches unrelated items.

By default, the analyzer filters to the GMA Veeqo channel/store named `Runway by Christian Siriano`.

The analyzer saves a readable report here after each run:

`reports/latest-analysis.md`

It also saves web report data here:

`reports/latest-analysis.json`

To view the browser dashboard:

```bash
npm run web
```

Then open:

`http://localhost:3000`

## Simple Portal Login

For a browser-accessible portal, set these values in `.env` on the server:

```bash
PORTAL_USERNAME=runway
PORTAL_PASSWORD=choose-a-private-password
PORTAL_SESSION_SECRET=choose-a-long-random-secret
VEEQO_ORDERS_URL=https://app.veeqo.com/orders
```

When `PORTAL_USERNAME` and `PORTAL_PASSWORD` are present, the dashboard requires login before loading reports or running Veeqo actions. The Veeqo API key stays server-side.

Active batches show:

- `Copy` next to the temporary Veeqo tag.
- `Open Veeqo`, which copies the tag and opens the Veeqo Orders page.

If we confirm Veeqo's tag-filter URL pattern, set:

```bash
VEEQO_TAG_FILTER_URL_TEMPLATE=
```

Use `{tag}` in the template where the URL-encoded batch tag should go. Until that is confirmed, the button opens the Veeqo Orders page and keeps the tag ready to paste.

## Online Deployment Notes

The app is ready to run as a simple hosted Node web service. Required production environment values:

```bash
VEEQO_API_KEY=...
VEEQO_BASE_URL=https://api.veeqo.com
VEEQO_CHANNEL_FILTER=Runway by Christian Siriano
VEEQO_ANALYZE_STATUS=awaiting_fulfillment
PORTAL_USERNAME=...
PORTAL_PASSWORD=...
PORTAL_SESSION_SECRET=...
VEEQO_ORDERS_URL=https://app.veeqo.com/orders
DATA_DIR=/data
```

Use a host that supports a persistent disk mounted at `DATA_DIR` so active/completed batch history survives restarts. The included `Dockerfile` can be used by most simple app hosts.

To test the analyzer mechanics against another channel without the GMA SKU filter:

```bash
npm run analyze -- --channel "Onsen Secret" --all-skus
```

This is still read-only.

To load a realistic local surge rehearsal without touching Veeqo:

```bash
npm run analyze -- --demo
```

The web dashboard also has a `Demo Data` button. Demo mode includes batch-size clusters, borderline clusters, multipack orders, unrelated channel orders, and non-GMA noise so the filtering and grouping behavior can be inspected before the event.

The dashboard includes demo-safe execution controls:

- Team member count for elapsed-time forecasting.
- Open vs fulfilled counts within the current dashboard session.
- Order mix chart.
- Carrier sub-batches so USPS, UPS, and Unknown orders are processed separately.
- Live carrier sub-batches use Veeqo shipping rates as the operational label source, with `delivery_method` as fallback.
- Start Batch and Mark Complete buttons.
- Cancel button for test/stale active batches; it removes the temporary Veeqo tag without counting the batch as fulfilled.
- Demo mode stays local-only.
- Live mode applies one temporary Veeqo tag to the selected carrier sub-batch, then removes it on completion.
- Completed batch history is stored locally in `data/batches.json`.

## Veeqo CSV Import Test

Veeqo supports importing new orders by CSV from the Orders import flow. The SKUs must already exist in Veeqo, and CSV import creates new orders only; it does not update existing orders.

Generate a small GMA test-order CSV:

```bash
npm run generate:test-csv
```

Output:

`test-data/veeqo-gma-test-orders.csv`

Import in Veeqo:

1. Go to Orders.
2. Click Import.
3. Select the CSV store / target store for `Runway by Christian Siriano`.
4. Upload `test-data/veeqo-gma-test-orders.csv`.
5. Wait for Veeqo to process the import.
6. Run `npm run analyze` or click Live Re-analyze in the dashboard.

Find the imported Veeqo order IDs:

```bash
npm run find:test-orders
```

## Temporary Tag Test

Only run this against imported test orders. The script requires explicit order IDs.

Apply a temporary test tag:

```bash
npm run tag:test -- --order-ids 123,456
```

Remove it:

```bash
npm run untag:test -- --order-ids 123,456 --tag "BATCH-TEST-..."
```

This is the bridge toward the real Tag & Batch workflow, but it is intentionally manual and explicit for now.
