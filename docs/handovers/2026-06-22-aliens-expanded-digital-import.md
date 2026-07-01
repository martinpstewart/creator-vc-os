# 2026-06-22 — Aliens Expanded Digital import (batch `aliens_expanded_digital_2024`)

## Summary
Imported the **Aliens Expanded Digital** sale (James: _"Aliens Expanded Digital Sale – no addons"_) into campaign **4 (Aliens Expanded 40th)**. Digital-only, Shopify-style export with **no order-ID column** and **billing address only** (no shipping). Source file: `Aliens Expanded Digital 1`.

## Result (verified)
| Object | Count | Notes |
|---|---|---|
| New product | 1 | `AE-DIGITAL` "Aliens Expanded Digital", campaign 4, `requires_address=false` |
| `historic_orders` | 1,221 | `shopify_legacy`, USD, gross **$32,462.80** |
| `historic_order_lines` | 1,221 | campaign 4, product `AE-DIGITAL`, `line_revenue` = realized order total |
| New contacts | 753 | `marketing_consent=false` (no opt-in in file) |
| `contact_sources` rows | 1,221 | `source_type='historic_order_import'`, one per order, audit metadata `import_batch` |
| Orders `contact_found=true` | 1,221 | 0 unresolved |
| New customers | 782 | digital → no shipping address populated; name + phone only |
| `customer_historic_orders` links | 1,221 | no multi-links |
| Aggregates | refreshed | bucketed `mod(customer_id,3)`; both snapshots refreshed |

Date range of orders: 2024-06-28 → 2024-12-06 (sits cleanly after the existing camp-4 `shopify_legacy` data which ended 2024-05-15).

## Decisions
- **Scope A — digital only.** Dropped the 3 `idwithin.xyz` test rows ($0, no paid_at) and the **15 non-digital "stray" lines** (11× Blu-ray $99, 3× T-Shirt+Blu-ray $139, 1× Digital-Only $49) that contradicted the "no addons" note and duplicate product types already fully present in campaign 4 (10,011 blu-ray + 3,204 digital-only lines).
- **New product (option A), not folded into `DIGITAL-EXPERIENCE`** — different price tier ($17.99–$29.99 vs $49) and distinct line name.

## Cross-checks
- **Gumroad question (Mart):** The Aliens digital doc *is* on Gumroad and that Gumroad data is already in the DB (4,874 orders; 433 "A New Species" + 682 filmography lines). **But this import is a different channel** — Shopify product "Aliens Expanded Digital" (absent from DB: 0 historic, 0 raw). Email overlap with existing Gumroad Aliens buyers = **17 of 1,216** (customers on both channels, not duplicate orders). No order-level duplication. Safe to import.
- **Idempotency:** synthesized `source_order_id = 'AED-' || md5(lower(email)||'|'||paid_at)`; 0 pre-existing `AED-` orders before load; all inserts guarded by `NOT EXISTS`.

## Orphan re-match circle-back
Checked whether the new emails/identities resolve any of the **1,705** `contact_found=false` (all emailless) backlog. Tested orphan `shipping_name`+zip and name+street (normalised) against the 1,220 new AED billing identities, single-candidate rule:
- name+zip matches: **0**
- name+street matches: **0**
- name-only coincidences: 2, both fail address → correctly excluded.

Reason: orphans are emailless physical KS/IGG fulfilment rows, a separate population from these digital billing-address buyers. **Backlog unchanged at 1,705.** No DB changes.

## Mechanics / conventions used
- `source_platform='shopify_legacy'`, `currency='USD'` (price tiers + discount math confirm USD; e.g. 24.00 = 29.99 discounted, 14.40 = 17.99 discounted).
- `gross_amount = net_amount = Total`; `refunded_amount = 0`; shipping fields NULL (digital).
- Order payload carries `import_batch`, `source_note`, and full billing block.
- Contacts consent sticky-upwards (existing untouched); new = false.

## Migrations run (named, in order)
1. `stg_aed_2024_create` — staging table
2. _chunk1 + chunk2 pasted via SQL editor_ (2× ~125KB; 611 + 610 rows) — staged 1,221 / $32,462.80
3. `aed_2024_promote_orders_lines` — product + orders + lines
4. `aed_2024_contacts` — new contacts + source rows + `contact_found`
5. `aed_2024_customers_link` — new customers + links + flags + contact↔customer backfill
6. `aed_2024_aggregates_bucket0/1/2` — bucketed aggregate refresh
7. `refresh_dashboard_snapshot()` + `refresh_customer_list_snapshot()` (separate calls)
8. `aed_2024_drop_staging`

## Reusable learnings
- **Order-ID-less Shopify export** → synthesize a deterministic `source_order_id` (`AED-md5(email|paid_at)`) for idempotency/future dedup. Digital exports key cleanly on email+paid_at (only multi-line group in this file was the test rows).
- **Digital imports have billing-only addresses** → leave `customers.shipping_*` NULL; address lives in order payload. This also means digital imports add no address-based orphan-match power.
- **`im@idwithin.com` extended:** `signups@idwithin.xyz` / `im@idwithin.xyz` (idwithin.xyz domain) also test data — exclude.
