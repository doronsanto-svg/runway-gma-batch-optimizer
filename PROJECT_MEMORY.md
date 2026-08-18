# Fillement Project Memory

## CBS Deals Refinement - 2026-08-17

- Active workspace: `cbs_deals`, displayed as **CBS Deals Fulfillment**.
- Membership is exclusively the first three normalized order-number characters: `CBS`. Leading punctuation and case are normalized; channel never controls CBS inclusion.
- CBS reports, batches, prepared status, sales, tracking audits, operations, and history are event-scoped. Existing GMA records stay stored but do not contribute to CBS views or actions.
- Live Sync is read-only. The persistent `CBS-DEALS` Veeqo tag is applied only by the explicit dashboard action.
- Batch starts are persisted operations with visible stages, restart recovery, package updates, final carrier refresh, per-order failures, chunk-level idempotency, and a 50-order tag maximum.
- Unknown products are held in Product Setup Review. CBS bundle `PL-RW-GAGBK3-R` expands to First Look, Spotlight, and Finishing Touch without double-counting combined parent/component payloads.
- Timer, forecast, station, and team metrics were removed. Operational statuses are Active and Parked; Park does not track elapsed time.
- Cached data displays immediately. Reports warn after 10 minutes and Veeqo writes are blocked after 30 minutes until Live Sync succeeds.
- Primary navigation is Dashboard, Prep, Issues, and History. Packaging, Sales, Tracking Repair, and Demo are Utilities; Sales is lazy-loaded and Demo is hidden in production.
- Verification: 53/53 automated tests passed. Browser checks passed at desktop, 903px, and 390x844 with no page-level horizontal overflow; 903px header was 82px and phone Quick Count operations began within the first viewport.
- Live read-only CBS sync on 2026-08-17 pulled zero CBS orders, expected before launch. Next required validation is 1–3 real CBS orders, then one 50-order rehearsal.

The material below is retained as historical GMA context and is not the current CBS operating contract.

Last updated: 2026-05-11

## Project Goal

Build a local web tool for the Runway by Christian Siriano Good Morning America Steals & Deals fulfillment surge on June 1, 2026. The tool connects to Veeqo, analyzes open orders, clusters identical SKU/quantity combinations, recommends the next batches to process, applies temporary Veeqo tags for native bulk printing, tracks batch completion times, and improves time forecasts during the event.

The first operational target is a working prototype before the May 28 dry run.

## Source Documents Reviewed

- `/Users/hamutsim/Desktop/Shipping Optimizar/Runway_GMA_Batch_Optimizer_Build_Spec.docx`
- `/Users/hamutsim/Desktop/Shipping Optimizar/Runway_GMA_Fulfillment_Operations_Manual.docx`

## Core Scope

The June 1 version should stay intentionally simple:

- Local Node.js + Express app running on the warehouse laptop.
- Vanilla HTML/CSS/JavaScript frontend.
- SQLite database for active batches and pack-rate history.
- Veeqo API integration using the existing API key.
- No cloud hosting, no multi-user accounts, no React app, no automation of Veeqo printing.

The tool supports one main runner workflow:

1. Pull open/unfulfilled orders from Veeqo.
2. Build cluster signatures from line items: sorted `SKU:quantity` pairs.
3. Group identical signatures into clusters.
4. Display batch candidates, borderline clusters, and the multipack queue.
5. Apply a temporary `BATCH-NOW-{timestamp}` tag to selected orders.
6. Runner filters by that tag in Veeqo and uses Veeqo bulk print.
7. Runner marks the batch complete in the tool.
8. Tool records pack time, updates pack-rate history, and removes the temporary tag.

## Current Build State

As of 2026-05-11:

- Project scaffold exists at `/Users/hamutsim/Desktop/Shipping Optimizar/batch-optimizer`.
- Private `.env` contains the local Veeqo key. `.env.example` is safe placeholder-only.
- `npm run check:veeqo` performs a read-only API check.
- `npm run analyze` performs a read-only full Ready To Ship analysis.
- `npm test` runs clustering unit tests.
- `npm run inspect:order-shape` can inspect non-PII order field shape when Veeqo payload questions come up.
- The analyzer filters to GMA-only orders and skips non-GMA or mixed GMA/non-GMA orders to avoid accidental unrelated batching.
- User clarified on 2026-05-11: Veeqo has both `Runway` and `Runway by Christian Siriano`; the GMA channel is `Runway by Christian Siriano`.
- The analyzer now filters by channel/store first. Default channel is `Runway by Christian Siriano`.
- The analyzer writes a readable latest report to `reports/latest-analysis.md`.
- Local web dashboard added on 2026-05-11. Run `npm run web` and open `http://localhost:3000`.
- Web dashboard reads `reports/latest-analysis.json` and has a Re-analyze button that runs the same read-only Veeqo analysis.
- Demo-safe dashboard execution controls added on 2026-05-11: team member count, fulfilled/open summary, order mix chart, Start Timer, and Mark Complete.
- Veeqo CSV import path checked on 2026-05-12: Veeqo supports importing new orders by CSV from Orders > Import, provided products/SKUs already exist. CSV imports create new orders only and do not update existing orders.
- Added `npm run generate:test-csv` to create `test-data/veeqo-gma-test-orders.csv` for a small GMA import test.
- Added explicit-order tag scripts `npm run tag:test -- --order-ids ...` and `npm run untag:test -- --order-ids ... --tag ...`; these are for imported test orders only.
- Carrier sub-batches implemented on 2026-05-12. Analysis splits each SKU signature by normalized carrier from `delivery_method`, with missing carrier shown as `Unknown`.
- Dashboard Start Batch now creates a local persistent batch record. Live batches apply a temporary Veeqo tag to only that carrier sub-batch; Mark Complete removes the tag and moves the batch to completed history in `data/batches.json`.
- Test CSV now includes `USPS Ground Advantage`, `UPS Ground`, and blank carrier values in `delivery_method`.
- On 2026-05-12 Veeqo UI showed a key distinction: the order `Delivery` field can say UPS while the actual Shipping Rates/label selector chooses USPS Ground Advantage. Live carrier splitting now uses Veeqo `/shipping/rates/{allocation_id}` and chooses the operational rate, with `delivery_method` only as fallback. For the GMA Test import, the corrected live analysis collapsed to 4 actionable USPS batches: Stage Bright 74, First Look 58, Spotlight 43, All Access 30.
- Active batches now have a Cancel action that removes the temporary Veeqo tag without counting the batch as fulfilled. Use this for stale/test batches, especially the old `BATCH-NOW-UPS-1778616519029` tag created before rate-based carrier detection.
- Simple portal login added on 2026-05-12. If `PORTAL_USERNAME` and `PORTAL_PASSWORD` are set in `.env`, the app requires login and uses an HTTP-only session cookie. Active/completed batches now show a Copy button next to the Veeqo tag; active batches also show Open Veeqo, which copies the tag and opens `VEEQO_ORDERS_URL` or `VEEQO_TAG_FILTER_URL_TEMPLATE` if a Veeqo filter URL is confirmed.
- On 2026-05-13 user started Stage Bright USPS; local active batch is `BATCH-NOW-USPS-1778686100046` with Veeqo tag ID `22267175`. UI was adjusted so active candidate rows show Active instead of Start Batch. Open Veeqo now links to local endpoint `/api/batches/:id/veeqo`, which redirects server-side to `https://app.veeqo.com/orders?tags[any_of]={tag_id}`. Verified active batch redirect returns `Location: https://app.veeqo.com/orders?tags[any_of]=22267175`.
- Later on 2026-05-13 active batch became First Look USPS (`BATCH-NOW-USPS-1778687998434`, tag ID `22267940`). Open Veeqo was simplified again to a direct same-tab URL `https://app.veeqo.com/orders?tags%5Bany_of%5D={tag_id}` with no JS popup/copy handler; browser cache busting and no-store headers were added. Pause/Resume support was added for active batches, and completion duration subtracts paused time.
- Render deployment prep added: `render.yaml`, public `/healthz`, package `start` script, persistent disk env `DATA_DIR=/data`, and Docker runtime config. `/healthz` verified locally returns `{"ok":true}` without login.
- For hosted deployment, batch history location is configurable with `DATA_DIR`; use a persistent disk such as `/data` so active/completed/canceled batches survive restarts. A minimal `Dockerfile` exists for simple Node hosting.
- For non-GMA functionality testing, run `npm run analyze -- --channel "Onsen Secret" --all-skus`.
- Current live read-only analysis pulled 4 `awaiting_fulfillment` orders: 1 GMA-only order and 3 non-GMA orders.
- Current GMA-only order was a seven-SKU combo signature, not one kit SKU. This may indicate bundle/kit line-item behavior needs special handling before tagging.
- Current sample Runway order has `total_price=0` and `subtotal_price=0`, apparently because it is discounted/test-like. Revenue logic may need another pass once paid GMA orders exist.

## Event Constraints

- GMA segment date: June 1, 2026.
- Orders expected to surge heavily in the first 4-6 hours and continue through a 48-hour sales window.
- Ship deadline: end of business June 4, 2026.
- Expected volume: several thousand orders, exact count unknown.
- Fulfillment model: two pack stations plus one runner, with possible 3-4 total people depending on volume.
- Accuracy is more important than maximum speed.

## Product Scope

There are 12 Runway GMA SKUs:

Singles:

- `PL-RW-FL30-R`: First Look
- `PL-RW-BTS100-R`: Behind the Scenes
- `PL-RW-SL30-R`: Spotlight
- `PL-RW-SB15-R`: Stage Bright
- `PL-RW-RR50-R`: Radiance Ready
- `PL-RW-AA90-R`: All Access
- `PL-RW-FT72-R`: Finishing Touch

Kits:

- `PL-RW-TOR2-R`: Overnight Recovery kit
- `PL-RW-TRE3-R`: Runway Essentials kit
- `PL-RW-TGP4-R`: Glow Protocol kit
- `PL-RW-TDTNR5-R`: Day-to-Night kit
- `PL-RW-TFR7-R`: Full Runway kit

## Batch Buckets

- Batch candidates: clusters with at least 10 orders by default.
- Borderline clusters: 5-9 orders.
- Multipack queue: 1-4 orders, collapsed by default and usually handled later.

Threshold should be configurable in the UI: 5, 10, 15, 20.

## Pack Categories

Forecasting should track separate pack rates for:

- `single_qty1`
- `single_qty2plus`
- `kit_small`
- `kit_large`
- `combo`
- `multipack`

Seed pack rates from the spec:

- `single_qty1`: 4.0 orders/min
- `single_qty2plus`: 3.5 orders/min
- `kit_small`: 2.5 orders/min
- `kit_large`: 1.5 orders/min
- `combo`: 1.5 orders/min
- `multipack`: 1.0 orders/min

Use real pack-rate history once at least two batches exist in a category. Rolling average should use the last five batches, weighted toward the most recent.

## Key Data Model

Tables needed:

- `pack_rate_history`: category, cluster signature, order count, duration, orders/minute, manual override flag, recorded timestamp.
- `active_batches`: batch tag, signature, label, order count, order IDs as JSON, station assignment, started timestamp, completed timestamp.

Consider adding:

- `analysis_snapshots`: optional, useful for debugging what the tool saw at a given time.
- `api_operation_log`: optional, useful for Veeqo tag application failures and recovery.

## Suggested Phase Plan

### Phase 0: API Reality Check and Skeleton

Goal: prove the Veeqo assumptions before UI work.

- Create local project scaffold.
- Add `.env` template with placeholder values only.
- Implement Veeqo API wrapper with auth, pagination, throttling, and retry basics.
- Confirm current Veeqo order status filters and order payload shape.
- Pull a small read-only sample from live Veeqo.
- Confirm where tags live and whether `PUT /orders/:id` with `order.tags` still works.

Exit criteria:

- We can list open orders.
- We can normalize line items into SKU/quantity data.
- We know the exact tag update endpoint and payload.

### Phase 1: Clustering Core

Goal: make the order intelligence correct without touching live orders.

- Implement signature generation.
- Implement SKU friendly-name map.
- Implement category classification.
- Implement bucket thresholds.
- Add unit tests for normal and edge cases.
- Add mock order fixtures for all 12 GMA SKUs.

Exit criteria:

- Sample orders produce expected clusters, labels, categories, and buckets.
- Multipack/combination behavior is clear and tested.

### Phase 2: Persistence and Forecasting

Goal: track active batches and learn pack speed.

- Add SQLite setup.
- Add active batch storage.
- Add pack-rate history.
- Add seed rates and rolling average calculation.
- Add duration override support.
- Add startup recovery for incomplete batches.

Exit criteria:

- Starting/completing a mock batch writes correct records.
- Forecast estimates update after historical batches.
- Incomplete batches reappear after restart.

### Phase 3: Batch Tagging Workflow

Goal: safely control real Veeqo batches.

- Add endpoint to create a batch from a signature.
- Apply unique Veeqo tag to all selected orders, throttled.
- Handle partial failures and show failed order IDs.
- Add endpoint to complete batch and remove tags.
- Test first on one test order, then 5-10 real/test orders during a quiet period.

Exit criteria:

- Tag appears in Veeqo and can be filtered.
- Tag removal works.
- Partial failures are visible and retryable.

### Phase 4: Runner Dashboard

Goal: make the tool usable during motion.

- Build single-page dashboard.
- Add Re-analyze flow.
- Add threshold and station controls.
- Add summary stats: unfulfilled count/revenue, fulfilled count/revenue, forecast time remaining.
- Add cluster sections: Batch, Borderline, Multipack.
- Add active batches panel.
- Add clear loading, success, and error states.

Exit criteria:

- Runner can decide the next batch within 5 seconds.
- Active batches are obvious.
- No confusing intermediate states during API calls.

### Phase 5: Dry Run Hardening

Goal: make it trustworthy before May 28.

- Run 30+ test orders covering singles, qty 2+, kits, and multi.
- Stress with 100+ test orders.
- Test two-station and three-station forecasts.
- Simulate network interruption mid-batch.
- Verify recovery after app restart.
- Tune UI copy and layout with the warehouse workflow in mind.

Exit criteria:

- Dry run completes end to end.
- Pack-rate forecasts are directionally useful.
- Known failure paths are documented.

### Phase 6: Event Mode

Goal: run cleanly on June 1-4.

- Freeze code before event unless critical fixes are needed.
- Confirm Veeqo API key, laptop, printer, network, and browser setup.
- Start with 30-60 minute order accumulation after the segment airs.
- Re-analyze every 30-45 minutes during surge.
- Export pack-rate history after event.

Exit criteria:

- All orders are shipped by end of business June 4.
- Pack-rate history is saved for future surge planning.

## Suggested Changes to the Current Spec

1. Confirm Veeqo API details immediately. The spec calls out possible changes in order statuses and rate limits. This is the highest-risk unknown.
2. Current public Veeqo docs list order status values including `awaiting_payment`, `awaiting_stock`, `awaiting_fulfillment`, `shipped`, `on_hold`, `cancelled`, and `refunded`. Start with `awaiting_fulfillment`, then confirm whether `awaiting_stock` should be included operationally.
3. Current public Veeqo docs expose `/bulk_tagging` for order tagging/untagging. Prefer bulk tagging over updating each order's full `tags` array if live testing confirms it works for order tags in this account.
4. Add a read-only preview mode before any tag writing. The first implementation should be able to analyze live orders without modifying anything.
5. Add a test mode / dry-run mode that simulates tag writes locally. This protects us while building UI and workflows.
6. Store the last analysis snapshot or at least the order IDs behind each cluster. This makes it easier to debug why a cluster looked the way it did.
7. Add explicit recovery actions for old `BATCH-NOW-*` tags: continue, complete, retry cleanup, or ignore locally.
8. Add packaging/station recommendation to each cluster row. The ops manual has enough detail to display Station A/B and package type.
9. Add a manual "exclude order from batch" path only if Veeqo data shows cancellations or hold orders commonly appear in the open queue.
10. Treat All Access pouch routing as an open packaging decision until test fit is confirmed.
11. Add CSV export after event for pack-rate and batch history.
12. Consider using timestamp plus short random suffix for every batch tag from the start, not only on collision.

## Open Questions

- Confirmed on 2026-05-11: Veeqo UI "Ready To Ship" maps to API status `awaiting_fulfillment`.
- Confirmed on 2026-05-11: `/orders?status=awaiting_fulfillment&page_size=5&page=1` returned HTTP 200 with pagination headers and usable order payloads.
- Confirmed on 2026-05-11: line item SKU can be read from `line_item.sellable.sku_code`; quantity can be read from `line_item.quantity`.
- Confirmed on 2026-05-11: `/tags` returned HTTP 200 and listed existing tags.
- Still to test: whether `/bulk_tagging` can safely add/remove order tags in this account.
- Are GMA orders identifiable only by SKU list, or should the tool also filter by store/channel/tag/order date?
- Should non-GMA open orders be excluded even if they contain one of these SKUs?
- Does the Veeqo order payload include product names reliably, or should labels always come from our constants map?
- Does Veeqo expose fulfilled/unfulfilled revenue in the same orders endpoint, or do we need separate summary calculation?
- Are kits represented as kit SKUs only, or can Veeqo break them into component SKUs in some payloads?
- Should tag cleanup happen on complete only, or should there be a standalone cleanup tool for emergency use?
- Which laptop and local port will be used during the dry run/event?

## Estimated Timeline and Complexity

Best-case build time: 12-18 focused engineering hours.

More realistic production-ready time: 20-30 hours, because Veeqo payload quirks, tag semantics, status filters, printer workflow, and dry-run hardening will likely take more time than the core clustering logic.

Complexity level: medium.

The algorithm is simple. The complexity comes from operational reliability:

- live API pagination and rate limits,
- safe batch tagging/removal,
- partial failure recovery,
- warehouse usability under time pressure,
- avoiding accidental modification of the wrong orders.

Recommended calendar:

- 1 day for API proof and clustering.
- 1 day for persistence, batch workflow, and tests.
- 1 day for dashboard.
- 1 day for Veeqo integration validation and hardening.
- 0.5-1 day buffer for dry-run fixes.

## Build Principles

- Read-only first, write second.
- Real Veeqo validation early.
- Keep the UI glanceable and operational, not decorative.
- Do not automate Veeqo printing in v1.
- Do not overbuild multi-user/cloud features for the June 1 event.
- Preserve pack-rate history after the event.
- Accuracy rules from the operations manual should be reflected in the UI where useful, especially station/package guidance and multi-order caution.
