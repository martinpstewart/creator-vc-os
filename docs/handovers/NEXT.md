# NEXT — Creator VC OS rolling handover
_Last updated: 2026-06-22 (after Aliens Expanded Digital import + orphan re-match circle-back)_

## Just completed
- **Aliens Expanded Digital imported** (batch `aliens_expanded_digital_2024`): 1,221 orders, **$32,462.80**, 1,221 lines, +782 customers, +753 contacts. New product `AE-DIGITAL` (campaign 4). Digital-only, billing address only. Excluded 3 `idwithin.xyz` test rows + 15 "no-addons" strays. Orphan re-match: **0** new matches.
- _(prior)_ AE Campaign 2 imported (batch `shopify_ae_2024_c2`): 10,485 orders, $1,113,309.26, 11,059 lines, +7,390 customers. New product 135 `ISOT-BOOK-NP` (campaign 9). 3 prior orphans re-matched.

## Current key numbers
- historic_orders: 101,000 · historic_order_lines: 122,800
- customers: 74,712 · contacts: 94,814
- orphan backlog (`contact_found=false`, all no-email): **1,705** (re-checked 22 Jun — AED added no single-candidate matches)

## On the horizon (open)
- **ISOD consolidation Phase 1** — migrate `isod_orders` (campaign 2, ~6,206) into `historic_orders`; gate was clear, awaiting execution.
- **Drop retired tables** — `campaign_orders`, `campaign_order_lines`, `customer_campaign_orders` + archives (after ISOD consolidation).
- **Emailless link-only durability (§3.2)** — 101 orders resolved link-only (no email backfilled) at risk of `contact_found` reverting on re-evaluation. Open decision on making durable. _(AE C2 + AED re-matches used durable/own conventions, not at this risk.)_
- **Orphan backlog (1,705)** — no single-candidate address matches remain (re-confirmed against AED 22 Jun); revisit only if a new source supplies emails for KS/IGG fulfilment rows.
- **Shelby Oaks (campaign 13)** — provenance/sourcing docs still needed.
- **Remaining James ingestions** — additional historical CSVs outstanding.
- **`shipping_amount` backfill** — still NULL for older batches incl. AE C2. (AED is digital → no shipping, exempt by design.)
- **Email sending system** — Amazon SES + Unlayer (Project 286722) for 100k+ sends; replaces Omnisend (~£18k/yr).
- **Microsites V2** — consent + double opt-in.
- **CSV ingestion tool for James.**
- **nl-query Edge Function (v5)** — schema-context overhaul pending.
- **`payhere_secret`** — single point of failure for hourly poll; replace with dedicated service key.
- **Webhook signing secret** — pasted in a prior transcript; flagged for rotation.
- **GitHub MCP write access** — still read-only (push → 403). Needs App installation with Contents: read & write on `martinpstewart/creator-vc-os` to enable direct commits from C Chat. Until then, handover commits go via Claude Code / manual paste.

## Reusable learnings added recently
- **Order-ID-less Shopify export** (22 Jun AED) → synthesize deterministic `source_order_id` (`AED-md5(email|paid_at)`) for idempotency. Digital exports key cleanly on email+paid_at.
- **Digital imports = billing-only addresses** → leave `customers.shipping_*` NULL; address lives in order payload. Digital imports therefore add no address-based orphan-match power.
- **`im@idwithin.com` test rule extended** → also `signups@idwithin.xyz` / `im@idwithin.xyz` (idwithin.xyz domain) = test data, exclude from imports.
- Shopify export variant: **Email repeated on every line; header = `Total`/`Paid at`, NOT Email.** Never detect headers by Email for this shape.
- `products`/`customers`/`customer_historic_orders` identity sequences can sit **behind `max(id)`** → `setval` before inserts that rely on identity.
- Customer↔historic-order linkage (`customer_historic_orders`) is **not auto-maintained** — populate per import, then bucketed `refresh_customer_aggregates` + both snapshots.
- **Customer detail snapshotting** (or splitting `get_customer_detail` so it's not a 1.1s query). `getCustomerByEmail` still uses `unstable_cache` as a band-aid.
- **Owner-callable "Refresh now" button** on `/settings` calling both refresh RPCs — lets C Chat invalidate after big imports without SQL access.
- **Vercel project transfer to Robin** (V8 §7).
- **Migrate off Robin's personal Freshdesk API key** to a service key (V8 §7).

## Watch items / be careful of
- **`im@idwithin.com` / `*.idwithin.xyz` are Aaron's test addresses — ALWAYS test data.** Exclude from every import (typically $0 unpaid rows like "Terrorbytes EP downloads" / "90s NEW"). Caught 4 such rows 22 Jun (AE C2 supplement); 3 more in AED.
- **Dedup tolerance for Shopify line-item exports**: local-time offsets (`+0000`/`+0100`) mean the same order can read 1h+ off stored UTC. Dedup on time-proximity + product + gross, scan every campaign + `raw_orders`, before declaring new.
- **`home_dashboard_compute()` is the function to edit** when a new `source_platform` is introduced (NOT `home_dashboard_impl`). Currently aware of: `shopify`, `shopify_legacy`, `gumroad`, `wix`, `indiegogo`, `kickstarter`, `crowdox` (latter rolls into Other Sources). AED used existing `shopify_legacy` → no change needed.
- **After any large import**, run both `public.refresh_dashboard_snapshot()` and `public.refresh_customer_list_snapshot()`.
- **Do NOT disable cron jobs 4 + 5** (`refresh-dashboard-snapshot`, `refresh-customer-list-snapshot`). They freeze the dashboard if stopped.
- **Do NOT TRUNCATE the snapshot tables** outside the refresh procs.
- **Same-franchise webhook ambiguity** (V8 §5.10): future dual-campaign franchise launch needs a parent tag / reattribution step.
- **`shipping_amount` is excluded from every roll-up by design** (V8 §5.5). Populate earlier batches first if ever requested.
- **Vercel Hobby tier**: `maxDuration=60` capped at 10s on serverless. Snapshot reads make /dashboard + /customers safe; other heavy queries vulnerable.
- **`deploy_edge_function` MCP tool is unreliable** — deploy edge functions via Supabase Dashboard paste.

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
