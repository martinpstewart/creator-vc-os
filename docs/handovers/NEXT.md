# NEXT.md — Creator VC OS

_Last updated: 2026-06-23 (C Chat)_

## Just completed
- **Aliens Expanded Collector's Edition import** (batch `AE_CE_2025`): 2,346 orders /
  2,584 lines / $233,429.27 gross; campaign 4 revenue $185,268.71; cross-sell units
  at $0 to campaigns 8/9/14; 6 new products (ids 137–142); 538 new customers,
  528 new contacts; aggregates refreshed; 0 orphans. Verified, staging dropped.
- **Pro upgrade**: project was Unhealthy on Free `t4g.nano` (CPU ~91%, burst credits
  exhausted) — app login + MCP both timing out. Upgraded to Pro; recovered. Data intact.

## Action required (front-end / Claude Code)
- **Dashboard shows stale numbers** — DB + `dashboard_snapshot` are CURRENT and already
  include AE CE (verified: live-built payload == stored snapshot; 2,346/$233k present in
  the Shopify bucket). Staleness is the **Vercel/Next.js ISR cache**. Fix = revalidate /
  redeploy the dashboard route. No DB action needed.

## Corrections to prior notes
- `refresh_dashboard_snapshot()` is **NO LONGER a no-op**. It now delegates to
  `aa_02_crm.refresh_dashboard_snapshot()` → `public.build_home_dashboard_payload()`,
  writing a real payload to `aa_02_crm.dashboard_snapshot` (cron every 5 min). The old
  "self-copying no-op / builder absent" note is obsolete — remove from the backlog.

## Snapshot architecture (reference)
- `dashboard_snapshot` ← `build_home_dashboard_payload()` — buckets by source_platform:
  shopify (incl. shopify_legacy) + live raw; gumroad; "shopify_legacy"/other =
  crowdfunding + isod_orders. Per-campaign breakdown is the OTHER bucket only.
- `customer_list_snapshot` ← `refresh_customer_list_snapshot()` (cron */10).
-
