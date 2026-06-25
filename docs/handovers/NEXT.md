# NEXT — Creator VC OS

**Supabase:** `xwokhafcllstcnlcberv` (eu-west-2) · connector **"Creator VC OS"** only
**Last updated:** 25 June 2026

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

## Snapshot performance (post-A1, post-A2)
- **Dashboard / campaigns-list snapshot compute.** `build_home_dashboard_payload()` and
  `get_campaign_stats_v3()` are slow (heavy compute, cheap write). Throttle holds them apart but
  they're not cheap — candidates for incremental/materialised aggregates if the IO/CPU profile needs
  flattening further. **Being optimised next** (C Chat) — see
  `claude-code-handover-2026-06-25-matview.md`.
- **Compute add-on review.** Project is on Pro but still **Nano** compute (43 Mbps baseline IO).
  Re-evaluate after the matview work — the goal is to get off the IO ceiling by cutting work, not by
  upsizing.

---
*Confidential — V88 / Creator VC OS · Supabase `xwokhafcllstcnlcberv`*
