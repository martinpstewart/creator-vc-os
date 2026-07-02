# Handover Addendum — Gumroad Attribution Overhaul, Digital Package Campaign & Retired-Table Cleanup

**Date:** 2026-07-01
**Author:** C Chat (Claude.ai / Supabase MCP)
**Trigger:** Robin asked why Aliens Expanded shows **0 Gumroad orders**. It wasn't missing data — it was systemically mis-attributed. Investigation uncovered a catalogue-wide Gumroad attribution fault plus a live regression against the 18 June `campaign_orders` retirement.

---

## 1. Root causes (three layers + one regression)

1. **`aa_01_campaigns.gumroad_products_map` defaulted almost everything to campaign 1.** Only FPS (c3) was ever pointed elsewhere.
2. **`gumroad-webhook` hard-coded `let campaign_id = 1`** as the fallback, so any unmapped product silently landed on The Thing Expanded.
3. **Live attribution resolves differently from historic.** The dashboard reads `product_campaign_id` from `aa_01_campaigns.v_raw_order_line_attribution`, which resolves each synthetic line's **SKU → `variants.legacy_code` → that variant's product's `campaign_id`**. It ignores both `raw_orders.campaign_id` and the map. Gumroad SKUs (e.g. `ALIENS-UPSELL-DIGITAL`) pointed at variants hanging off **products parked on c1**, so live sales leaked to c1 regardless of the map.
4. **Regression:** both webhooks were still writing to the RETIRED `campaign_orders` / `campaign_order_lines` / `customer_campaign_orders` tables — they had silently refilled to ~1,900 rows since the 18 June retirement.

> Historic lines store `campaign_id` directly on `historic_order_lines` (easy UPDATE). Live orders do **not** — they're SKU-resolved through the variant graph. Both layers had to be fixed separately.

---

## 2. Decisions (with Mart / James)

- **Aliens Expanded** digital → campaign 4, pointed at existing product **136 `AE-DIGITAL`**.
- **CreatorVC Digital Package** = new **campaign 17** (`DIGITAL_PACKAGE`), header-only home for cross-film bundles (Filmography, 80s Trilogy, 90s Horror). Added `campaigns.campaign_type` flag (`documentary` default; 17 = `package`) so bundle campaigns aren't treated as documentaries.
- **Star Wars Day Special** → header on c17 **plus $0 component lines to ISOT (c9) and AE (c4)** per James ("owners should be tagged as having purchased ISOT and AE"). This is the only bundle with per-film credit; the others are header-only.
- **Unmapped products → option (a):** captured **unattributed** (no holding campaign), surfaced via a monitor view. A brand-new Gumroad product can't be auto-resolved; the design makes it loud + one-line to fix.
- Ambiguous mappings resolved against campaign names: **ISOD Part 1 → c8** ("In Search of Darkness 80's"), **ISOD 1995-1999 → c2** ("In Search of Darkness 1995").

---

## 3. What changed (DB — all executed & verified)

**Migrations, in order:**
1. `reattribute_ae_gumroad_digital_to_c4` — map id 6 → `AE-DIGITAL`/c4; rewrote 433 AE historic lines c1→c4.
2. `create_digital_package_campaign_17` — `campaign_type` column; campaign 17; product 152 (`DIGITAL-PACKAGE`, c17).
3. `create_gumroad_digital_variants` — variants **100–106**: `AE-DIGITAL`@136/c4, `ISOD-9599-DIGITAL`@149/c2, `ISOD80S-DIGITAL`@42/c8, and 4 package variants (`*-PKG`)@152/c17.
4. `fix_gumroad_products_map_all` — every row → correct campaign + a `variant_legacy_code` that resolves there; **added the missing TTE-2026 row** (`gumroad_product_id='azmru'` → `THING-DIGITAL`/c1, which had been masked by the c1 default).
5. `reattribute_gumroad_historic_lines` — CASE rewrite of gumroad `historic_order_lines` to true campaigns; Star Wars $0 component fan-out to c9 + c4 (`resolver_method='bundle_component_synth'`).
6. `realign_live_gumroad_payload_skus` — rewrote `raw_orders.payload->line_items[0].sku` for the mis-homed set + bundles + TTE-2026 so `v_raw_order_line_attribution` resolves them. (Part 2/3, TerrorBytes, ISOT, FPS already resolved correctly and were left untouched.)
7. `refresh_raw_attribution_mv` — `REFRESH MATERIALIZED VIEW mv_raw_order_line_attribution` (non-concurrent).
8. `create_v_gumroad_unmapped_monitor` — `aa_01_campaigns.v_gumroad_unmapped` (grants anon/authenticated/service_role).
9. `raw_orders_campaign_id_nullable_for_unmapped` — dropped NOT NULL on `raw_orders.campaign_id` so unmapped orders are captured, not rejected, under the webhook's null fallback.
10. `reempty_retired_campaign_orders_tables` — deleted `customer_campaign_orders`, `campaign_order_lines`, `campaign_orders` (children first) **after** both webhooks were fixed.

Snapshots refreshed: `refresh_dashboard_snapshot()`, `refresh_campaigns_list_snapshot()`. Customer snapshot skipped (totals unchanged — revenue only moved campaigns).

**Edge functions (deployed by Mart via Dashboard):**
- `gumroad-webhook` **v10** — null fallback (was `= 1`); removed retired-table writes.
- `shopify-webhook` **v41** — removed retired-table writes (the main refill source); campaign resolution unchanged.

---

## 4. Final Gumroad distribution (verified)

| Campaign | Historic lines / rev | Live orders |
|---|---|---|
| 1 The Thing Expanded (2026) | 95 / $2,863.60 | 150 |
| 2 ISOD 1995-99 | 295 / $6,632.38 | 52 |
| 3 FPS | 382 / $6,485.69 | 38 |
| 4 Aliens Expanded | 451 / $7,390.29 | 101 |
| 5 TerrorBytes | 115 / $2,928.49 | 19 |
| 8 ISOD 80's (Part 1) | 793 / $18,432.87 | 3 |
| 9 ISOT | 239 / $3,519.04 | 44 |
| 10 ISOD Part 2 | 456 / $12,670.42 | — |
| 11 ISOD Part 3 | 41 / $1,226.59 | — |
| 14 ISOD 90-94 | 812 / $13,769.79 | 81 |
| 17 CreatorVC Digital Package | 1,231 / $29,049.88 | 129 |

Live: **617/617 resolve, 0 unresolved.** Historic totals unchanged (Star Wars components are $0). `v_gumroad_unmapped` = 0. Retired tables all at 0; `_campaign_orders_archive` preserved (19,090).

---

## 5. Key learnings / gotchas

- **Live order attribution ≠ `raw_orders.campaign_id` and ≠ `gumroad_products_map`.** It's SKU → `variants.legacy_code` (upper-match) → `variant.product.campaign_id`, via `v_raw_order_line_attribution` → `mv_raw_order_line_attribution` (cron-refreshed every 15 min). To fix live attribution you must land the SKU on a variant whose **product** sits on the right campaign.
- `gumroad_products_map.variant_legacy_code` is **NOT NULL** — use a real variant code, not null.
- `raw_orders.campaign_id` **was NOT NULL** — a null-fallback webhook would have *rejected* (lost) unmapped orders until this was relaxed.
- Blu-ray cross-sell products (2, 4, 5, 10, 15, 16, 17…) deliberately live on c1 and co-mingle gumroad digital variants; **do not repoint those products** — create dedicated digital variants instead (mirrors how c4 already had product 136 `AE-DIGITAL`).
- `execute_sql` with multiple statements returns **only the last** result set — run counts as a single UNION or separate calls.
- The webhook stamps `gumroad_mapped:false` on the payload; the monitor keys off `product_campaign_id IS NULL` (current resolvability), not that stale flag.

---

## 6. On the horizon / open items

- **DROP the empty shells** (`campaign_orders`, `campaign_order_lines`, `customer_campaign_orders`) + archive-DDL scratch next clean cycle — recommend a few days of confirmed zero writes first.
- **Shopify webhook HMAC** re-tighten (auth currently open per its own TODO; `SHOPIFY_WEBHOOK_SECRET` under Edge Functions → Secrets).
- **Shopify `campaign_id = 1` default parity** — left as-is (Shopify resolves reliably via `shop_domain` then order-number legacy code); tighten to null + a monitor if desired.
- Consider a **live Star Wars fan-out** path if that bundle sells again — the $0 component synthesis is currently historic-only; the webhook writes a single line.

---

## 7. NEXT.md updates to make on commit

- Add: "Gumroad attribution overhaul complete (2026-07-01) — see addendum. Campaign 17 CreatorVC Digital Package live; `campaign_type` flag added; `v_gumroad_unmapped` monitor active."
- Add: "gumroad-webhook v10 / shopify-webhook v41 deployed — retired-table writes removed; `campaign_orders` set retired-empty again."
- Add to open items: DROP retired shells next cycle; Shopify HMAC; Shopify default-campaign parity.
