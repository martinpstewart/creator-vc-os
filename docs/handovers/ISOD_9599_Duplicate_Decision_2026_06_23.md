# ISOD 95-99 Shopify Campaign 1 — Import Decision: DUPLICATE, NO IMPORT

**Date:** 23 June 2026
**File:** `ISOD_9599_Shopify_Campaign_1__ISOD_9599_Shopify_Campaign_1_csv.csv`
**Outcome:** Not imported. File is a duplicate of an existing campaign.

## Finding
The file is the **same 2025 Shopify store already imported as campaign 2 (`ISOD_95`, "In Search of Darkness 1995")**, which lives in `isod_orders`.

Evidence (all read-only, against Creator VC OS / `xwokhafcllstcnlcberv`):

| Signal | File | isod_orders camp 2 (in-window) | isod_orders camp 2 (full) |
|---|---|---|---|
| Date span | 2025-05-15 → 2025-06-16 | same | 2025-05-15 → **2025-11-03** |
| Orders | 4,633 | 4,654 | 6,206 |
| Distinct emails | 4,606 | 4,459 | — |
| Line revenue | ~$497,829 | $424,090 | — |

- Clean prices match: isod stores `87.99` (STANDARD) / `119.99` (DELUXE); the file carries the **same orders with FX-jittered prices** (`88.01`, `120.32`, etc.).
- Revenue gap (~$74k) is explained: file prices the double-pack (~$52k) and cross-sells (~$17k); `isod_order_lines` left those add-on lines at `NULL` price.
- Count/email deltas are minor (window-edge orders + email normalisation), not a different dataset.
- `isod_orders` is the **more complete** copy (extends to Nov 2025).

Conclusion: importing into `historic_orders` camp 2 would **duplicate** live `isod_orders` records.

## Decision (Mart, 23 June 2026)
Treat the file as a duplicate. **Archive it. No import.**

## Notes for later (not actioned)
- `isod_order_lines.line_sku` is **NULL** across the board (SKUs live in `sku_assigned` / `sku_after_correction`); add-on/cross-sell lines have **no `price_paid`**. So existing camp 2 data is thinner on SKU+price detail than this file. If ever needed, an *enrichment* pass (backfill SKUs/prices into isod camp 2) is the right shape — **not** a re-import.
- Cross-sell product homes confirmed during investigation: `FNG16097` → camp 8, `ISOT-BLU-RAY-NP` → camp 9, `ISOD-90s-HORROR-BLU-RAY` → camp 14. (`ALIENS-BLU-RAY` and `DIGITAL-BUNDLE-CVC-FILMOGRAPHY` had no exact product match — moot now.)
- Camp 2 still has **zero rows** in the `products` table; its products would only become relevant if/when the gated `isod_orders → historic_orders` consolidation runs.

## DB changes this session
None. Read-only investigation only.
