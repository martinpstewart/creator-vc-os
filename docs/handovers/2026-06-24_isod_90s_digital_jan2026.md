# Session handover — ISOD 90s Digital Sale (January 2026)

**Date:** 2026-06-24
**Author:** Claude (claude.ai — Project: Creator VC OS)
**Supabase:** xwokhafcllstcnlcberv (eu-west-2), connector "Creator VC OS"
**Source file:** `ISOD 90s Digital Sale January 2026` (James). Note: *"2 products — 95-99 digital and 90-94/95-99 digital doublepack. No blu-rays etc."*

## Summary

Imported a two-week digital-only Shopify flash sale (15–30 Jan 2026) of the two ISOD 90s films. **748 net-new orders, $22,984.88 paid**, no overlap with anything already in the DB. Two new products created; both digital, no address required.

## Overlap verification (clean — no duplicates)

January 2026 sits **before** the live Shopify webhook era, so no `raw_orders` collision risk, and this was confirmed:
- `raw_orders` in the 2026-01 window: **0**.
- `isod_orders` (campaign 2 standalone store) date range ends **2025-11-03** — no Jan 2026 rows.
- `historic_orders` Jan-window contained only Gumroad trickle sales + a TerrorBytes `tb_c12` shopify_legacy batch (different products).
- Exact **(email | timestamp) collisions across all three order homes: 0**.
- 4 Aaron test rows (`im@idwithin.com`, Total 0) excluded. 5 emails recur in-file = distinct second-level timestamps (returning buyers), 0 true duplicate rows.

## Products created (max id was 148)

| id | campaign | Name | legacy_code | price | requires_address |
|----|----------|------|-------------|-------|------------------|
| 149 | 2 (ISOD 95-99) | Digital Bundle (95-99 only) - Digital | `ISOD-9599-DIGITAL` | $27.99 | false |
| 150 | 14 (ISOD 90-94) | 1990's Digital Double Pack (90-94 & 95-99) - Digital | `ISOD-90S-DIGITAL-DOUBLE` | $34.99 | false |

File SKUs `SINGLE` → 149, `DOUBLE` → 150. (`90s-DIGITAL-BUNDLE` appeared once, on an Aaron test row only — excluded.)

## Decisions (Mart: "1A 2A go")

1. **Doublepack home = campaign 14** (90-94). It spans both films; homed whole on camp 14 as a single product at full price (matches the existing 90-94 product family; consistent with how prior multi-film digital bundles were modelled — one product, one campaign, not decomposed). SINGLE → campaign 2 regardless.
2. **gross_amount / line_revenue = actual Total paid** (not list subtotal). 19 orders carried a 20% discount (13× SINGLE @ $22.40, 6× DOUBLE @ $28.00). The older §5.5 "gross = lineitem subtotal" convention existed only to strip shipping; there is no shipping on digital, so the actual paid Total is the true revenue. List price + discount preserved in payload (`list_subtotal`, `discount_amount`, `list_price`).

## What landed

- **+748 `historic_orders`** — `source_platform='shopify'`, `payload.batch='shopify_isod_90s_digital_2026'`, synthetic `source_order_id = 'isod90sdig-' || md5(lower(email)|paid_at|total|sku)[:12]`, `order_status='paid'`, `currency='USD'`, `net_amount=NULL`, `refunded_amount=0.00`, `contact_found=true` (all). Order payload: `{batch, import, order_total, list_subtotal, discount_amount, sku_raw, fx_basis:'usd_native'}`.
- **+748 `historic_order_lines`** — one per order, `resolver_method='sku_exact'`, `line_revenue = paid Total`, line payload `{batch, mapped_code, src_line_seq:1, list_price, discount_amount}`. 0 NULL-campaign lines.
  - Campaign 2 (SINGLE): 452 lines / **$12,634.79**
  - Campaign 14 (DOUBLE): 296 lines / **$10,350.09**
- **+257 customers** (75,804 → 76,061); 486 of the 743 distinct buyer emails were already customers.
- **+246 contacts** (497 already existed). New contacts: `marketing_consent=false`, no consent source (a purchase is not marketing consent), customer-linked, `is_test=false`, first/last_seen = min/max order date. Pre-existing contacts lacking `customer_id` were linked.
- **+748 `customer_historic_orders`** junction.
- **+748 `contact_sources`** — one per order, `source_type='historic_order_import'`, `campaign_id` = that order's product campaign (2 for SINGLE, 14 for DOUBLE), `metadata={batch}`.
- Per-customer aggregates refreshed for all 743 buyers (bucketed mod(id,4)); dashboard + customer-list snapshots refreshed.
- **Orphan backlog unchanged at 1,704** (every order has an email and is linked — no new orphans).

## Migrations (in order)

1. `isod90sdig_seed_products_and_staging` — products 149/150 + `public._isod90sdig_staging`.
2. Two staging chunk files pasted by Mart (374 + 374 rows).
3. `isod90sdig_promote` — orders → lines → customers → junction → contacts → contact_sources → contact_found (all idempotent; identity sequences setval-guarded first).
4. `isod90sdig_refresh_aggregates_0..3` — per-customer aggregate refresh, bucketed.
5. `SELECT public.refresh_dashboard_snapshot();` + `SELECT public.refresh_customer_list_snapshot();` (execute_sql).
6. `isod90sdig_drop_staging`.

## ⚠️ Notable — campaign 2 now spans two order homes

Before this session, **campaign 2 (ISOD 95-99) lived ONLY in `isod_orders`** (6,206 orders) and had **zero products**. It now also has **452 lines in `historic_orders`** via new product 149. This is the first time camp 2 has presence in `historic_orders`.

**Implication for the gated ISOD consolidation (Step 2):** the consolidation design (`ISOD_Consolidation_Design_2026_06_18.docx`) assumed camp 2 = `isod_orders` only. It must now account for camp 2 already having a `historic_orders` footprint (product 149, batch `shopify_isod_90s_digital_2026`) so the fold-in does not double-count or clash on `(source_platform, source_order_id)`. The `isod` batch (`isod_1995_legacy`) and this `shopify` batch are distinct namespaces, so they coexist cleanly, but the design doc should be annotated.

## Live DB after session

- `historic_orders`: **106,986** (was 106,238).
- `customers`: 76,061. `isod_orders`: 6,206 (unchanged). `raw_orders`: 19,194 (unchanged).
- Products max id: 150.
