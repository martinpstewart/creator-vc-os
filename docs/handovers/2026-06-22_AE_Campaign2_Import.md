# Handover — Aliens Expanded Campaign 2 Import + Orphan Re-match
**Date:** 2026-06-22
**Author:** C Chat (claude.ai — database/data work)
**Connector:** Creator VC OS (`postgres`) — verified at session start.

---

## Summary

Imported **Aliens Expanded Campaign 2** (Shopify export, Apr–May 2024) into `historic_orders`/lines + CRM, then ran an orphan re-match pass leveraging the newly added customers.

- **10,485 paid/partial orders**, gross **$1,113,309.26**, 11,059 lines, 10,361 distinct emails.
- Source: `Aliens Expanded Shopify Campaign 2` (James). Batch tag: **`shopify_ae_2024_c2`**.
- **Dedup: 0 exact duplicates, 0 source-id collisions, 0 raw overlaps** — all net-new (campaign 4 previously held only `shopify_ae_2022`).

## Critical parse note (for future Shopify exports of this shape)
This export repeats **Email on every line row**, but populates **Paid at / Financial Status / Total only on the order's first row**; continuation line-items have those blank.
→ **Detect the order header by `Total` (or `Paid at`) being non-blank, NOT by Email.** An initial pass that filtered on `Financial Status in (paid,...)` silently dropped all continuation lines (multi-line orders looked single-line; 574 continuation rows were misread as "unpaid"). Corrected; line-extension then reconciled to order Total exactly ($0.00 variance). 479 orders are multi-line (up to 5 lines).

## Tier → product attribution (per-line home campaign)
| SKU (file) | Lines | Units | Product → Campaign |
|---|---|---|---|
| BLU-RAY-PACKAGE | 5,696 | 5,748 | 117 → 4 (AE) |
| DIGITAL-EXPERIENCE | 2,691 | 2,720 | 119 → 4 (AE) |
| BLU-RAY-PACKAGE-TEE | 2,115 | 2,142 | 118 → 4 (AE) |
| ASSOCIATE-PRODUCER | 25 | 25 | 120 → 4 (AE) |
| PRODUCER | 5 | 5 | 121 → 4 (AE) |
| ISOT-BLU-RAY | 331 | 337 | 63 `ISOT-BLURAY` → 9 (ISOT) *(cross-sell)* |
| ISOT-BOOK-NP | 169 | 170 | **135 (NEW)** → 9 (ISOT) *(cross-sell)* |
| DARKNESS-UNLIMITED | 27 | 27 | 134 `DARKNESS-UNLIMITED-SIX-MONTHS` → 14 *(cross-sell)* |

Line revenue by campaign: AE(4) $1,089,052.77 · ISOT(9) $23,581.37 · ISOD 90-94(14) $675.12 = $1,113,309.26.

**New product created:** id **135** `ISOT-BOOK-NP` "In Search of Tomorrow Book - No Personalisation", campaign 9, `requires_address=true`.

## Decisions
- `partially_refunded` (14 orders) **left as-is** (accurate to source; `refunded_amount=0` as the file carries no refund detail). The paid-only customer-aggregate function therefore excludes them: **10 customers whose only order is partially_refunded show `total_orders=0`**, and ~$2k is not reflected in paid-only dashboard figures. Accepted.
- Identity sequences for `products`, `customers`, `customer_historic_orders` were **behind `max(id)`** (legacy manual inserts) → resynced with `setval(...)` to avoid PK collisions.
- `source_order_id` synthesised deterministically: `ae2024-<md5(email|paid_at|total)[:12]>` (mirrors `ae2022-` convention). Order header fields = `shopify_legacy`, `gross=net=order_total`, `order_created_at=paid_at`, `currency=USD`. `shipping_amount` left NULL.

## Migrations applied (in order)
1. `ae_c2_create_staging_and_book_product_v2` — staging table `public.stg_ae_c2` + product 135 + seq resync
2. staging load — 14 chunk files `stg_ae_c2_01..14` pasted via SQL editor (11,059 rows)
3. `ae_c2_promote_1_historic_orders` (+10,485)
4. `ae_c2_promote_2_order_lines` (+11,059)
5. `ae_c2_promote_3_contacts_new` (new emails only)
6. `ae_c2_promote_4_contact_sources` (+10,485, `historic_order_import`, campaign 4)
7. `ae_c2_promote_5_set_contact_found`
8. `ae_c2_crm_1_create_customers` (+7,390) · `ae_c2_crm_2_flag_has_historic` · `ae_c2_crm_3_link_customer_historic_orders` (+10,485)
9. `ae_c2_crm_4_agg_bucket_00..19` (aggregate refresh, mod(id,20))
10. `ae_c2_orphan_rematch_3` · `ae_c2_rematch_refresh_aggregates`
11. `ae_c2_drop_staging`
12. snapshots via `execute_sql`: `public.refresh_dashboard_snapshot()`, `public.refresh_customer_list_snapshot()`

## Orphan re-match pass
Target = 1,708 `contact_found=false` orders (all no-email). Matched against the (AE-C2-enriched) customer pool on normalised **name+zip OR name+street, single-candidate only**.
- Only 4 single-candidate matches existed; **3 strongest applied** (durable: email backfilled, `contact_found=true`, `customer_historic_orders` link, `contact_source` audit `ae_c2_rematch_2026_06_22`):
  - 9703 Frederic St Georges → fstgeorges3@hotmail.com (name+zip+street)
  - 9023 Darren Muir → darrenm2001@icloud.com (name+zip, full UK postcode)
  - 92141 Brett Day → aubreymi6@ymail.com (name+zip, full UK postcode)
- **Skipped:** 92116 James Spencer / 45342 (US 5-digit zip + common name; too weak).
- Remaining ~1,705 orphans have no single-candidate address match (mostly Kickstarter/Indiegogo fulfilment rows that never carried emails). No further attribution possible from address data alone.

## Final DB state
| Metric | Value |
|---|---|
| historic_orders | 99,779 |
| historic_order_lines | 121,579 |
| customers | 73,930 |
| contacts (aa_03_marketing) | 94,061 |
| orphan backlog (`contact_found=false`) | 1,705 |
| AE C2 batch orders / gross | 10,485 / $1,113,309.26 |
