# NEXT — Creator VC OS rolling handover
_Last updated: 2026-06-22 (after AE Campaign 2 import + orphan re-match)_

## Just completed
- **AE Campaign 2 imported** (batch `shopify_ae_2024_c2`): 10,485 orders, $1,113,309.26, 11,059 lines, +7,390 customers. New product 135 `ISOT-BOOK-NP` (campaign 9). 3 prior orphans re-matched.

## Current key numbers
- historic_orders: 99,779 · historic_order_lines: 121,579
- customers: 73,930 · contacts: 94,061
- orphan backlog (`contact_found=false`, all no-email): **1,705**

## On the horizon (open)
- **ISOD consolidation Phase 1** — migrate `isod_orders` (campaign 2, ~6,206) into `historic_orders`; gate was clear, awaiting execution.
- **Drop retired tables** — `campaign_orders`, `campaign_order_lines`, `customer_campaign_orders` + archives (after ISOD consolidation).
- **Emailless link-only durability (§3.2)** — 101 orders resolved link-only (no email backfilled) at risk of `contact_found` reverting on re-evaluation. Open decision on making durable. _(Note: AE C2 re-matches used durable resolution + payload audit markers, so they are not at this risk.)_
- **Orphan backlog (1,705)** — no single-candidate address matches remain; revisit only if a new source supplies emails for KS/IGG fulfilment rows.
- **Shelby Oaks (campaign 13)** — provenance/sourcing docs still needed.
- **Remaining James ingestions** — additional historical CSVs outstanding.
- **`shipping_amount` backfill** — still NULL for older batches incl. AE C2.
- **Email sending system** — Amazon SES + Unlayer (Project 286722) for 100k+ sends; replaces Omnisend (~£18k/yr).
- **Microsites V2** — consent + double opt-in.
- **CSV ingestion tool for James.**
- **nl-query Edge Function (v5)** — schema-context overhaul pending.
- **`payhere_secret`** — single point of failure for hourly poll; replace with dedicated service key.
- **Webhook signing secret** — pasted in a prior transcript; flagged for rotation.
- **GitHub MCP write access** — still read-only (push → 403). Needs App installation with Contents: read & write on `martinpstewart/creator-vc-os` to enable direct commits from C Chat. Until then, handover commits go via Claude Code / manual paste.

## Reusable learnings added this session
- Shopify export variant: **Email repeated on every line; header = `Total`/`Paid at` present, NOT Email.** Never detect headers by Email for this shape.
- `products`/`customers`/`customer_historic_orders` identity sequences can sit **behind `max(id)`** → `setval` before inserts that rely on identity.
- Customer↔historic-order linkage (`customer_historic_orders`) is **not auto-maintained** — must be populated per import, followed by bucketed `refresh_customer_aggregates` then both snapshots.- **Customer detail snapshotting** (or splitting `get_customer_detail` so it's not a 1.1s query). `getCustomerByEmail` still uses `unstable_cache` as a band-aid.
- **Owner-callable "Refresh now" button** on `/settings` that calls both refresh RPCs. Useful for C Chat to manually invalidate after big imports without needing SQL access.
- **Vercel project transfer to Robin** (V8 §7 build/platform).
- **Migrate off Robin's personal Freshdesk API key** to a service key (V8 §7).
- **Email sending system**: Amazon SES + Unlayer (replaces Omnisend). `aa_03_marketing` ready on the DB side; Claude Code hasn't started the UI yet.

## Watch items / be careful of

- **`im@idwithin.com` is Aaron's test address — ALWAYS test data.** Exclude from every import (typically $0 unpaid rows like "Terrorbytes EP downloads" / "90s NEW"). Caught 4 such rows in the 22 Jun supplement.
- **Dedup tolerance for Shopify line-item exports** (22 Jun): these exports carry local-time offsets (`+0000`/`+0100`), so the same order can read 1h+ off the stored UTC value. Always dedup on time-proximity + product + gross, and scan every campaign + `raw_orders`, before declaring an order new.
- **`home_dashboard_compute()` is the function to edit** when a new `source_platform` is introduced (NOT `home_dashboard_impl`, which is now a one-liner reading the snapshot). Currently aware of: `shopify`, `shopify_legacy`, `gumroad`, `wix`, `indiegogo`, `kickstarter`, `crowdox` (latter rolls into Other Sources via NOT IN).
- **After any large import**, run both `public.refresh_dashboard_snapshot()` and `public.refresh_customer_list_snapshot()` so the app reflects the new data instead of waiting up to 10 min for cron.
- **Do NOT disable cron jobs 4 + 5** (jobnames `refresh-dashboard-snapshot` and `refresh-customer-list-snapshot`). They freeze the dashboard if stopped.
- **Do NOT TRUNCATE the snapshot tables** outside the refresh procs. The procs do it inside a transaction; readers stay safe via MVCC.
- **Same-franchise webhook ambiguity** (V8 §5.10): when a future franchise goes live under two campaigns at once, the Shopify webhook can't disambiguate. A parent-franchise tag or reattribution step is needed before then.
- **`shipping_amount` is excluded from every roll-up by design** (V8 §5.5). Robin doesn't want shipping in the dashboard. If a future request asks for it, populate the column for earlier batches first.
- **Vercel is on Hobby tier**. `maxDuration = 60` is silently capped at 10s on serverless functions. The snapshot reads make this irrelevant for /dashboard + /customers, but other heavy queries are still vulnerable.
- **Per the docs, claude.ai's `deploy_edge_function` MCP tool is unreliable.** Deploy edge functions via the Supabase Dashboard paste instead.

## Quick reference

| Object | Owner | Refresh cadence | Notes |
|---|---|---|---|
| `aa_02_crm.dashboard_snapshot` | DB | 5 min cron | Single row, jsonb payload |
| `aa_02_crm.customer_list_snapshot` | DB | 10 min cron | GIN indexes for filter/search |
| `home_dashboard_compute()` | DB | runs once per dashboard refresh | The heavy aggregator |
| `home_dashboard_impl()` | DB | served from snapshot | App calls this |
| `get_customers_list()` | DB | served from snapshot | App calls this |
| `public.refresh_dashboard_snapshot()` | DB | admin/cron callable | Manual override |
| `public.refresh_customer_list_snapshot()` | DB | admin/cron callable | Manual override |
| `home_dashboard()` | DB | admin-gated wrapper | Calls `_impl` |
| `getCustomerByEmail()` cache | App | 10 min Next.js unstable_cache | Per-email key |

## How to use this folder

1. Read `NEXT.md` (this file).
2. Skim the most recent dated docs for context only if needed.
3. Do your work.
4. At end of session: write a new dated `YYYY-MM-DD-short-slug.md`, update `NEXT.md` to reflect the new state, commit both with your code changes.
