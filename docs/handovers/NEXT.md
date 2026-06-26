# NEXT — Creator VC OS

**Supabase:** `xwokhafcllstcnlcberv` (eu-west-2) · connector **"Creator VC OS"** only
**Last updated:** 26 June 2026

---

## Shopify webhook (resolved 26 June, pm)

**`shopify-webhook` v40 is live, ingesting cleanly.** Two issues fixed
in sequence:
1. **Auth was rejecting native deliveries.** v37/v38 added HMAC + token
   dual-auth but `SHOPIFY_WEBHOOK_SECRET` was never actually set on the
   function (debug capture confirmed `secret_length: 0`). Per Martin's
   call to unblock Aaron, v39 stripped the gate and now requires only
   an `X-Shopify-Topic` header — every legitimate Shopify delivery sets
   it, random bots get a quiet 200 ignored.
2. **`raw_orders` upsert was hitting 42P10.** The unique index is
   `(source_platform, shopify_order_id)` but the upsert specified
   `onConflict: "shopify_order_id"` alone, AND `source_platform` was
   left NULL on the row. v40 sets `source_platform: "shopify"` and
   changes onConflict to `"source_platform,shopify_order_id"`. End-to-
   end smoke test: `raw_orders → campaign_orders → customer +
   junctions + aggregates` all written.

**Security trade-off accepted, TODO to re-tighten:** when there's
bandwidth, restore HMAC by (1) confirming `SHOPIFY_WEBHOOK_SECRET` is
set under **Edge Functions → Secrets** (NOT Project Settings / Vault),
(2) restoring the dual-auth gate from v37's commit.

## BLOCKED — Shopify backfill (still waiting on Admin API access)

The native `orders/create` webhook had been 401'ing at the platform JWT gate since
**2026-05-12 11:57 UTC** — see `2026-06-26-shopify-webhook-fix-and-backfill.md`.

**What's done:**
- `shopify-webhook` deployed at **v37, `verify_jwt=false`**, with in-function dual-auth
  (HMAC against `SHOPIFY_WEBHOOK_SECRET` OR token match against `SUPABASE_ANON_KEY`). Going
  forward, native Shopify deliveries authenticate and ingest again.
- Replay script ready at `scripts/replay-shopify-orders.mjs` — idempotent, throttled,
  retries 429/5xx. Just needs credentials.

**What's blocked:**
- The 12 May → 26 Jun gap (~6 weeks of orders) is unrecovered. No data source we currently
  have access to carries full line-level orders for that window:
  - PayHere covers 9 Jun → now (2,001 rows) but is financial-only — no line items, no
    addresses. Also misses 12 May → 8 Jun entirely.
  - Acutrack exports are shipping confirmations, not orders.
- Owner of the project doesn't have Shopify backend access; needs to chase whoever does
  (Robin / Aaron?) for a `shpat_…` Admin API token (`read_orders` + Protected customer data).

**When the token arrives:**
1. `node scripts/replay-shopify-orders.mjs --since 2026-05-12T00:00:00Z` (see brief for envs)
2. After completion: `SELECT public.refresh_dashboard_snapshot();
   refresh_campaigns_list_snapshot(); refresh_customer_list_snapshot();`
3. Verify daily counts dense from 12 May onwards.

**Also flagged (separate follow-ups):**
- Campaign 7 (ISOD 70s) products are unmapped in `aa_01_campaigns.shopify_products_map` —
  backfilled 70s orders will land in `raw_orders` but won't attribute to campaign 7 until
  mapped (`ISOD_70s`, `THING_EXPANDED_UPSELL`, `ISOD_95_99_UPSELL`, `ISOD-9094`).
- `get_campaign_products_v2` RPC intermittently 500s — visible in API logs.

---

## Last session (25 June 2026 — Claude Code)
- **Repo-parity sweep for the 25 June DB/Edge work** (everything already live in prod —
  `xwokhafcllstcnlcberv` — this was just code-side catch-up). Brief:
  `2026-06-25-snapshot-perf-and-freshdesk.md`.
- **freshdesk-webhook v15** pasted into `supabase/functions/freshdesk-webhook/index.ts` (ack-first,
  `EdgeRuntime.waitUntil()`-deferred capture + ingest). **Repo parity only — NOT redeployed via CLI**;
  a stale deploy would revert v15.
- **Five A1 migrations transcribed** into `supabase/migrations/`:
  `20260625080736_throttle_and_stagger_snapshot_crons`,
  `20260625084057_…_step1_infrastructure`,
  `20260625084228_…_step2_functions`,
  `20260625084413_…_step3_seed_watermark`,
  `20260625084522_…_step5_cron_cutover`.
- **App-side audit clean:** zero callers of `refresh_customer_list_snapshot` in the TS/TSX code, zero
  consumers of the per-row `refreshed_at`. Nothing to repoint. The new contract (per-row `refreshed_at`,
  `aa_02_crm.snapshot_watermarks` for the list-level cursor) is uncontested — any future "list last
  updated at X" indicator should read the watermark, not the per-row column.

### A2 follow-on (later same day — Claude Code)
- **`campaign_backers_snapshot` is now incremental** (live in prod). Public RPC:
  `public.refresh_campaign_backers_snapshot_incremental()` → int rows processed. Cron job 7 →
  `*/5 * * * *`; new job 9 → `32 3 * * *` nightly full reconcile. Snapshot schema + row contents
  unchanged.
- **Three A2 migrations transcribed** into `supabase/migrations/`:
  `20260625091132_incremental_campaign_backers_step1_functions`,
  `20260625091245_…_step2_seed_watermark`,
  `20260625091319_…_step4_cron_cutover` (step 3 was a one-time catch-up run, not preserved).
- **App-side audit clean:** zero TS/TSX callers of `refresh_campaign_backers_snapshot`. Same
  `refreshed_at` semantics flip as A1 — for the backers list use `max(refreshed_at)` or
  `snapshot_watermarks WHERE name='campaign_backers'` for a "last updated at X" indicator.
- Full `public.refresh_campaign_backers_snapshot()` kept ONLY for the nightly reconcile + an
  explicit admin force-rebuild action (none exists yet).

### Matview + dashboard-gate round (later same day — Claude Code)
- **Pulled 7 round-2 migrations** for repo parity (all already live in prod):
  `20260625091251_…_step3_first_run` (the step 3 I had skipped in the round-1 sweep),
  `20260625093625_attribution_matview_step1_create`,
  `20260625093708_…_step2_refresh_cron`,
  `20260625093857_…_step3a_repoint_campaign_stats`,
  `20260625094045_…_step3b_repoint_dashboard`,
  `20260625095518_dashboard_change_gate_step1_function`,
  `20260625095649_…_step2_cron_cutover`.
- **Repointed the 6 remaining attribution reads to the matview** in a new migration
  (`20260625100000_repoint_remaining_attribution_reads_to_matview`). All 6 are analytics surfaces
  (Products tab, catalogue units strip, Ask schema-context view, plus three RPCs with no active
  callers); none are on a real-time-after-write path so 15-min matview staleness is acceptable. Used
  the safe `pg_get_functiondef`/`pg_get_viewdef` + `regexp_replace` with `\m…\M` word-boundary
  pattern (catches both schema-qualified FROMs and bare `v_raw_order_line_attribution.col`
  references in the view body, without colliding with `mv_raw_order_line_attribution`). Verified all
  6 now reference the matview. `get_campaign_products_v2(1)` 580ms → 290ms; `get_campaign_units_sold_v2(1)` ~580ms → 20ms.
- **App-side audit clean:** zero TS/TSX callers of the full backer rebuild, zero readers of the
  per-row `refreshed_at` on either snapshot, no dashboard "updated every 30 min" UI copy to fix
  (the only "Last updated" label in the app is on `SendDetail.tsx`, marketing-side, unrelated).

## Last session (23 June 2026)
- **SlasherTrash Shopify Campaign 1 — IMPORTED → new campaign 15 (`SLASHERTRASH_DOC`).** 2,892 orders /
  3,478 lines / $254,979.67 (24 Jul–21 Aug 2025), `source_platform=shopify_legacy`, batch
  `slashertrash_c1_2025`. No overlap with `raw_orders` (pre-webhook 2025 store) or `historic_orders`.
  6 new products (ids 143–148); cross-sells routed to existing home products — FNG16097→8, ISOD-90s→14,
  ISOT-BLU-RAY-NP→9, ALIENS-BLU-RAY remapped to `BLU-RAY-PACKAGE` (117, camp 4). +543 customers / +531
  contacts / +2,892 junction / +2,892 contact_sources. Snapshots refreshed. Full record:
  `2026-06-23_slashertrash_c1.md`.
- **Orphan re-match (opportunistic):** the new buyer pool resolved **1** emailless order durably
  (order 9569 → `y.kevin.young@gmail.com`, name+zip+street, email backfilled). Backlog **1,705 → 1,704**.
- **Earlier same day — ISOD 95-99 Shopify Campaign 1: NOT IMPORTED (duplicate)** of live campaign 2
  (`ISOD_95`, `isod_orders`). Archived, no import. Record: `ISOD_9599_Duplicate_Decision_2026_06_23.md`.
- Connector note: "Creator VC OS" can fail to load on first `tool_search` — toggle/retry. Verify with
  `current_database()` + a known count at session start (multiple Supabase connectors share
  `mcp.supabase.com` — Tweakease / FreeFlight / Music-Hub are the wrong projects). The connector also had
  a transient outage mid-session (even `SELECT 1` failed); it recovered on retry — not a query problem.

---

## Immediate / next imports
- **Remaining James master-index ingestions** — overlap-fingerprint **before** each (per import protocol).
  Check **all three order homes** — `isod_orders`, `raw_orders`, `historic_orders` — not just
  `historic_orders`+`source_file`. The 95-99 case proved the live DB can already hold an entire "new" file.
  Watch the recurring-franchise pattern (same documentary as crowdfunding + later Shopify = separate
  campaigns).
- **raw_orders era reminder:** webhook era is **2026-02-24 onward**. Pre-2026 Shopify files do not overlap
  raw_orders by date; the live dedup surface for them is `historic_orders` + `isod_orders`.
- **SlasherTrash recurring-franchise watch:** if a SlasherTrash crowdfunding (KS/IGG) or later Shopify file
  surfaces, it is a separate campaign/era from campaign 15 — fingerprint before import.

## Order-table consolidation programme
- **campaign_orders (Step 1, DONE):** DROP the three empty tables + scratch/archive tables next clean cycle.
- **isod_orders (Step 2, DESIGNED, GATED):** fold 6,206 orders / 8,117 lines into `historic_orders`
  (`source_platform='isod'`, batch `isod_1995_legacy`). Design: `ISOD_Consolidation_Design_2026_06_18.docx`.
  - **Gate:** Claude Code's `has_historic_orders` KPI-badge fix is deployed to prod but **uncommitted to
    git** — commit/push before Phase 1.
  - **Carry-in from 95-99 session:** camp 2 has **zero `products` rows**, and `isod_order_lines.line_sku` is
    NULL (SKUs in `sku_assigned`/`sku_after_correction`) with add-on/cross-sell lines un-priced. If richer
    SKU+price detail is ever wanted for camp 2, that's an **enrichment** pass from the 95-99 file — not a
    re-import.

## Data & provenance
- **Emailless link-only flag durability:** 101 link-only resolutions — make `contact_found` recheck
  marker-aware (`payload.contact_resolved_via='name_zip_match'`) **or** backfill matched emails. (Order
  9569 this session was backfilled, so durable.) Until the 101 are addressed an email-driven recheck could
  revert their flag (junction/aggregates safe).
- **Remaining emailless:** **~1,704** (5 ambiguous; rest no counterpart). Fuzzier matching only (partial
  name / address-line / zip-prefix). Re-run name+zip / name+street sweep opportunistically after each large
  customer-adding import.
- **Campaign 13 (Shelby Oaks):** contacts-only (~13k), no orders/products — confirm provenance.
- **shipping_amount:** populated for `shopify_isod3_part3_2022_c2` only; backfill earlier batches from
  payload if shipping reporting wanted. (SlasherTrash had no shipping residual — Total = line subtotal.)
- **Customer-dedup candidate:** Rachel Green pair (customers 66684 / 66685).

## Build / platform
- **Email sending:** Amazon SES + Unlayer (Project 286722) replacing Omnisend; `aa_03_marketing` ready.
  Microsites V2 (consent + double opt-in). CSV ingestion tool for James's historic data.
- **Freshdesk:** "Ticket Updates" automation rule; Film→campaign mapping; historical XML backfill
  (~127 files); migrate off Robin's personal API key.
- **Dashboard RPC bucket-label fix:** `shopify_legacy` currently routing into the `shopify` KPI bucket.
- **`refresh_dashboard_snapshot()`:** genuine aggregation builder still to locate/restore from migration
  history (current fn is a self-copying no-op).
- **Handover items:** Vercel project transfer to Robin; replace `payhere_secret` (Mart's personal key) with
  a service key.
- **GitHub write access:** still 403 (`Contents: write` not granted on `martinpstewart/creator-vc-os`).
  Handover commits manual or via Claude Code until fixed.

## Snapshot performance (post-A1 / A2 / matview / gate)
- **Dashboard rebuild still ~32s when it does run.** The gate eliminates most rebuilds, but each
  real one is still heavy. If the profile needs flattening further the lever is the historic
  re-aggregation — `build_home_dashboard_payload` scans `historic_orders`/`historic_order_lines`
  6–8× per build, plus `v_paying_customer_emails` (~4.8s `UNION DISTINCT`). Candidate: scan
  historic once into a temp table per build, derive the shopify/gumroad/other rollups from it.
  Optional — polish, not firefighting.
- **`mv_raw_order_line_attribution` refresh cost.** Full `CONCURRENTLY` recompute (~7–8s) every
  15 min. If `raw_orders` write volume grows, consider gating the refresh on a `raw_orders`
  change signal rather than unconditional cadence.
- **Compute add-on review.** Still on **Nano** (43 Mbps baseline IO). With A1/A2 + matview +
  gate the heavy rebuilds are gone and IO pressure is well off the ceiling — re-evaluate
  whether an upsize is even needed before spending on it.

---
*Confidential — V88 / Creator VC OS · Supabase `xwokhafcllstcnlcberv`*
