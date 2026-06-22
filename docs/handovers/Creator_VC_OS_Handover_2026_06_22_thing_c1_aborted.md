# Session — 2026-06-22 — The Thing Expanded Shopify Campaign 1 import: ABORTED (duplicate)

## Outcome
Import of `The Thing Expanded Shopify Campaign 1` (4,635 paid orders / 6,129 lines / $594,309.16) was **investigated, planned, then aborted before any write.** No DB changes made; staging table never created; local staging artifacts deleted.

## Why aborted
The file overlaps `raw_orders`, not `historic_orders`.
- `raw_orders` campaign 1 holds **14,974 orders from 2024-08-08 onward** (still growing via live webhook).
- File window = 2024-08-08 → 2024-09-06 (campaign launch month), fully inside that coverage.
- **4,626 / 4,635 file orders (99.8%) already exist in `raw_orders` c1** by exact email+total; 4,630/4,635 match on email.
- Only 9 file orders don't match on email+total; of those, 5 emails already have a c1 raw_order at a different total, leaving **0–4 possible genuine gaps** (and those may be refunds/cancels/test rows).
- Importing would have double-counted ~4,626 orders — `raw_orders` already feeds `v_all_orders` and `refresh_customer_aggregates`.

Decision (Mart): **A — drop entirely.** Not investigating the ≤4 stragglers.

## LESSON (add to import protocol)
**Any campaign that ran during the live-Shopify/webhook era is already in `raw_orders`. Before importing a CSV, overlap-check against `raw_orders` (by campaign_id, then email+total in the file's date window) — not just `historic_orders` + `source_file` tag.** Campaign 1 (Thing Expanded, 2024) is fully live-captured. Likely applies to any other 2024+ Shopify campaign file.

## Confirmed product/attribution facts (retain, even though unused)
- Campaign 1 is the home for the 2024 Thing storefront. Existing products cover all file SKUs — no seeding needed:
  - THING-* bundles → `THING`; LOGO-* → `THING-LOGO`; POSTER-* → `THING-POSTER` (all c1)
  - AE upsell → `ALIENS` (c1); ISOD-Trilogy upsell → `ISOD-80s-TRILOGY` (c1) — **Option A confirmed by Mart** (kept on c1, not home campaigns 4/8; no trilogy $0-component synth)
  - ISOT upsell → `ISOT-BLURAY`/`ISOT-DIGITAL`/`ISOT-BOOK-NP` (c9)
- James note resolved: T-shirt *bundle* and T-shirt *addon* both treated the same → c1.
- File has no order-number column; line revenue ties exactly to header Total (no shipping/tax drift).
- No `im@idwithin.com` test rows present.

## Next
- No action required for Thing Expanded C1.
- Apply the raw_orders overlap check to remaining James Shopify files before importing any.
