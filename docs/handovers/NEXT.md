# NEXT — current state of the world

_Last updated 22 June 2026 by C Chat._

Read this file first. Skim the dated session docs only if you need detail.

## What's done

- **TerrorBytes C1+2 supplement imported (22 Jun).** The James file "TerrorBytes Campaign 1 +2" was ~99% already in the DB (most of it landed earlier as batch `terrorbytes_c12_2026_06`, 691 orders). A dedup hunt found **15 genuinely-new paid orders**, imported as batch `terrorbytes_c12_2026_06_supplement` (IDs `tb_c12_2026-0692…0706`, $687.85, 17 lines: 13→camp 5, 3→camp 1, 1→camp 3). All customers/contacts pre-existed. `historic_orders` 89,279 → 89,294. Full detail + reusable dedup method in [2026-06-22-terrorbytes-c12-supplement.md](2026-06-22-terrorbytes-c12-supplement.md). **Most remaining James files will be the same shape — dedup hunts, not bulk imports.**
- **Snapshot architecture is live.** `home_dashboard_impl` and `get_customers_list` no longer compute on read — they SELECT from `aa_02_crm.dashboard_snapshot` (5 min cron) and `aa_02_crm.customer_list_snapshot` (10 min cron). The heavy aggregator is now `home_dashboard_compute()`. Cron jobs 4 + 5 in `cron.job` table. Manual refresh: `public.refresh_dashboard_snapshot()` / `public.refresh_customer_list_snapshot()`. Full detail in [2026-06-18-snapshot-architecture.md](2026-06-18-snapshot-architecture.md). The PWA was timing out at Vercel's 10s ceiling before this landed; sub-100ms now.
- **C Chat handover V8 imported** into [2026-06-18-c-chat-handover-v8.md](2026-06-18-c-chat-handover-v8.md). Covers the Part III C2 import, AE-2022 import, orphan resolution passes, snapshot read-path, shipping_amount column. Still the structural canonical base.
- **Badge-fix commit gate cleared.** The `has_historic_orders` KPI badge fix is at commit `5e54f4f` on `origin/main` (committed 18 June 2026). ISOD consolidation can proceed.
- **Dashboard bucket-label fix** is shipped at commit `cb54388`. The new historic `source_platform = 'shopify'` (ISOT 2022) now routes into the Shopify column on the dashboard.

## What's open

### Owned by C Chat (database / data)

- **ISOD consolidation Phase 1.** Fold the 6,206 `isod_orders` into `historic_orders` (`source_platform='isod'`, batch `isod_1995_legacy`). Design doc done, gate is clear. Trigger via existing migration plan in `ISOD_Consolidation_Design_2026_06_18.docx`. After fold: call `public.refresh_customer_list_snapshot()` to update the snapshot.
- **DROP retired tables.** `campaign_orders`, `campaign_order_lines`, `aa_02_crm.customer_campaign_orders` + their `public._*_archive` siblings. Currently empty and safe.
- **Emailless link-only flag durability.** The 101 §3.2 resolutions from V8 were link-only — `payload.contact_resolved_via='name_zip_match'` marker set, email NOT backfilled. Decide whether to make any contact_found recheck marker-aware OR backfill emails. Until decided, an email-driven recheck would revert the flag.
- **Campaign 13 (Shelby Oaks) provenance.** Contacts-only marketing audience (~13k). No orders / no products. Confirm import provenance.
- **Remaining historic ingestions** from James's master index. **Treat each as a dedup hunt, not a bulk import** — the source exports overlap heavily with what's already loaded. Run the duplicate fingerprint per V8 §3.5, plus the two refinements from the 22 Jun session: (a) match email + time-proximity (±1 day), never exact second — Shopify exports carry mixed `+0000`/`+0100` offsets; (b) check ALL campaigns + `raw_orders`, since upsell-only orders attribute to the upsell's home campaign.
- **`wood565497` NULL-line artifact.** Pre-existing header with zero lines: `source_order_id 5729424867605`, 2024-02-22, $49.99, batch `terrorbytes_2026_05_27`. Stray from the 27-May TerrorBytes import (not the 22-Jun supplement). A "historic_orders with no lines" sweep would catch it; left untouched pending Mart's call.
- **`shipping_amount` backfill** for earlier batches if Robin ever wants shipping reporting. Currently only `shopify_isod3_part3_2022_c2` is populated.

### Owned by Claude Code (frontend / app)

- **Suspense-per-card refactor on home dashboard** (Tier 1.3 from the perf options). Would make cold loads near-instant by streaming each channel column independently. Lower priority now that the snapshots return in 1.5ms — but the dashboard still does ~80kB of HTML render at once.
- **Customer detail snapshotting** (or splitting `get_customer_detail` so it's not a 1.1s query). `getCustomerByEmail` still uses `unstable_cache` as a band-aid.
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
