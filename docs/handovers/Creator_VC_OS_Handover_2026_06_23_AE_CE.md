# Creator VC OS — Session Handover — 2026-06-23

## Summary
Imported the **Aliens Expanded Collector's Edition** (2025 event) into `historic_orders` /
`historic_order_lines`, with full customer + contact linkage. Also resolved a project
availability incident (see below).

## Infrastructure event — Free → Pro upgrade
- Project went **Unhealthy** on Free tier (`t4g.nano`, CPU pinned ~91%). Symptoms: app login
  hanging and MCP/SQL connection timeouts. **Not** a billing block — compute exhaustion on a
  burstable nano (burst credits spent → throttled to baseline).
- Resolution: upgraded to **Pro**. Connector + app recovered immediately; queries return
  instantly. Data intact (restart/upgrade is non-destructive).
- Watch item: nano was undersized for current load (≈100k+ historic_orders, 122k+ lines, live
  Shopify/Gumroad/Freshdesk webhooks + Freshdesk poller). Keep an eye on the CPU graph; size
  compute accordingly.

## Import: Aliens Expanded Collector's Edition — batch `AE_CE_2025`
Source file: *Aliens Expanded Collectors Edition* (Shopify line-item export, no order-number
column; order boundary = each row with a populated `Total`).

### Pre-checks (all clean)
- `raw_orders` overlap: **none** — live webhook was not capturing this 2025 store/event (0 rows
  in 2025-04-24 → 2025-05-06 window).
- `historic_orders` overlap: **0** exact (email+total) collisions across all campaigns.
- Aaron (`im@idwithin.com` / `idwithin.aaron@gmail.com`): **0 rows**.
- No trailing "Totals" summary row.

### Locked numbers (file = DB, verified post-load)
| Metric | Value |
|---|---|
| Orders | 2,346 |
| Lines | 2,584 |
| Gross (sum of order Total) | $233,429.27 |
| Campaign 4 attributed revenue | $185,268.71 |
| Distinct buyers | 2,339 |
| New customers / new contacts | 538 / 528 |
| Junction rows / contact_sources | 2,346 / 2,346 |
| Orphans (contact_found=false) | 0 |

### Attribution (cross-sell rule: home campaign, $0 revenue, units only)
| SKU | Product id | Campaign | Lines | Qty | Revenue |
|---|---|---|---|---|---|
| ALIENS-1-DISC-UPGRADE | 138 | 4 | 1,511 | 1,531 | $99,912.94 |
| ALIENS-2-DISC | 139 | 4 | 845 | 859 | $85,355.77 |
| AE-6DOC-DIGITAL-BUNDLE | 137 | 4 | 51 | 52 | $0.00 |
| ISOT-BLU-RAY-NP | 142 | 9 | 107 | 111 | $0.00 |
| FNG16097 | 140 | 8 | 37 | 43 | $0.00 |
| ISOD-90s-HORROR-BLU-RAY | 141 | 14 | 33 | 34 | $0.00 |

Decisions (confirmed by Mart):
1. Cross-sell SKUs created as **new** products under home campaigns (distinct 2025 re-press SKUs,
   not collapsed into originals).
2. 6-Documentary Digital Bundle (no SKU) → **campaign 4** at $0, synthetic code
   `AE-6DOC-DIGITAL-BUNDLE`.

### Migrations applied (in order)
1. `ae_ce_2025_create_staging` — `public._ae_ce_staging`
2. *(SQL editor paste ×3)* — bulk load 2,584 rows
3. `ae_ce_2025_products` — 6 products (ids 137–142, `max(id)+1` guarded)
4. `ae_ce_2025_promote_orders` — 2,346 orders, `order_status='paid'`,
   `source_order_id='AE_CE_2025-<idx>'`, `ON CONFLICT DO NOTHING`
5. `ae_ce_2025_promote_lines` — 2,584 lines (NOT EXISTS guard per order)
6. `ae_ce_2025_customers` — 538 new customers (DISTINCT ON lower(email))
7. `ae_ce_2025_link_contacts` — junction + new contacts + customer_id backfill + contact_sources
   (`historic_order_import`, campaign 4)
8. `ae_ce_2025_refresh_aggregates` — `refresh_customer_aggregates()` for affected customers
9. `ae_ce_2025_drop_staging`

### Notes / conventions reaffirmed
- `customers.email` plain text (match on `lower()`); `contacts.email` citext (match `= x::citext`,
  never `lower(citext)`).
- `products` has no identity default → `max(id)+1`. Other target tables are GENERATED ALWAYS
  AS IDENTITY (id omitted).
- `refresh_customer_aggregates()` counts only `order_status='paid'`; no live trigger attached
  (called explicitly post-load).
- Batch fully re-runnable via idempotent guards.

## Still open (carried forward)
- GitHub write access (403 on push) — handover commits still manual / via Claude Code.
- `refresh_dashboard_snapshot()` self-copying no-op — genuine builder still to be restored.
- ISOD consolidation Phase 1; deprecated-table retirement; Microsites V2; Freshdesk XML backfill;
  emailless orphan backlog (~1,705).
