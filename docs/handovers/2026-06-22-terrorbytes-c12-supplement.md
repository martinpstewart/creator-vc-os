# TerrorBytes Campaign 1+2 — supplement import (15 stragglers)

_Written by C Chat (claude.ai) at end of session, 22 June 2026. Structural canonical base remains [2026-06-18-c-chat-handover-v8.md](2026-06-18-c-chat-handover-v8.md); this doc only covers what changed this session._

## TL;DR

A new James file, **"TerrorBytes Campaign 1 +2"**, turned out to be ~99% already in the DB — most of it had been imported in a prior session as batch `terrorbytes_c12_2026_06` (691 orders). The job was therefore a **dedup hunt for orders NOT already present**, not a bulk import. After correcting for timezone/DST drift and cross-campaign attribution (see Dedup method below), the file yielded **15 genuinely-new paid orders**. These were imported as batch `terrorbytes_c12_2026_06_supplement`, IDs `tb_c12_2026-0692 … 0706`. All 15 customers and contacts already existed; this was orders + lines + junctions + contact_sources only.

**This is the shape of most remaining James ingestions** — the source exports overlap heavily with what's already imported. Budget each one as a dedup exercise. The three lessons below are the reusable part.

## Dedup method (reusable — read before the next James import)

Naïve dedup on `email + exact timestamp` falsely flagged ~1,900 of 4,344 orders as "new." The real figure was 15. Two corrections collapsed the false positives:

1. **Match on email + time-proximity, never exact second.** This file's `Created at` runs **+1 hour ahead of the DB for BST/summer orders** (the export carries mixed `+0000`/`+0100` offsets) and is a few seconds off elsewhere. Exact-second matching misses the existing row and reports a duplicate as new. Match within a ±1-day window (then confirm on product + gross), not on equality.
2. **Check ALL campaigns + `raw_orders`, not just the file's "home" campaign.** A TerrorBytes-store order whose only line is an FPS or Filmography **upsell** is stored under the upsell's home campaign (FPS = 3, Filmography bundle = 1), per the cross-sell attribution rule (V8 §5.7). So a campaign-5-only comparison makes those orders look absent when they're already in the DB under campaign 1/3. Cross-checking every campaign + `raw_orders` cut 35 candidates to 19.
3. **`im@idwithin.com` is Aaron's test address — always exclude.** Of the 19 survivors, 4 were $0 unpaid test rows on this address ("Terrorbytes EP downloads" ×3, "90s NEW"). Dropped → 15 real paid orders.

General duplicate-safety pattern is unchanged (V8 §3.5): email + timestamp + gross fingerprint, swept per-batch and vs `raw_orders`, before every import. The addition this session is the **time-proximity tolerance** and the **all-campaigns** scope — fold both into the fingerprint for any Shopify line-item export that carries local-time offsets.

## What was imported

15 orders, gross **$687.85**, all `paid`, `source_platform='shopify_legacy'`, `contact_found=true`. Conventions copied verbatim from the parent `terrorbytes_c12_2026_06` batch (synthetic `source_order_id` `tb_c12_2026-NNNN` continuing from max suffix 691; `payload.csv_row` = full original row incl. offset; `payload.metadata.import_batch='terrorbytes_c12_2026_06_supplement'`).

17 lines (two orders carry a Filmography bundle + a TerrorBytes digital line):

| campaign | lines | line revenue | products |
|---|---|---|---|
| 5 (TerrorBytes) | 13 | $511.89 | DIGITAL-1999/2799/4499, STANDARD-BR, DELUXE-BR |
| 1 (Thing Expanded) | 3 | $89.97 | FILMOGRAPHY-DIGITAL-BUNDLE (cross-sell) |
| 3 (FPS) | 1 | $49.99 | FPS-BLURAY-UPGRADE (cross-sell) |

Line revenue $651.85; the $36.00 gap to gross is **shipping on the two Blu-ray orders** (danbeshai $97.99 vs $79.99 line; geondp $137.99 vs $119.99 line), held at order level, not on lines — consistent with the parent batch. `shipping_amount` was left NULL (this batch predates the V8 §5.5 shipping-column convention and the residual is recoverable from `payload`).

Side effects: +15 `customer_historic_orders` junctions, +15 `aa_03_marketing.contact_sources` (`historic_order_import`), aggregates refreshed for the 15 affected customers, both snapshots refreshed.

## Migrations run (in order)

1. `tb_c12_supplement_orders` — 15 `historic_orders`. Verified: 15 rows, $687.85.
2. `tb_c12_supplement_lines` — 17 `historic_order_lines`. Verified: 13 / 3 / 1 by campaign.
3. `tb_c12_supplement_customer_links` — 15 `customer_historic_orders`. Verified: 15.
4. `tb_c12_supplement_contact_sources` — 15 `contact_sources`. Verified: 15.
5. `tb_c12_supplement_refresh_aggregates` — `refresh_customer_aggregates` for the 15 customer IDs (188, 2808, 14279, 23167, 26593, 31366, 33561, 34048, 34081, 34090, 34158, 34649, 34753, 35055, 35491).
6. `SELECT public.refresh_dashboard_snapshot();` then `SELECT public.refresh_customer_list_snapshot();` (separate calls).

Verification: `historic_orders` total 89,279 → **89,294** (+15 exact). Spot-check customer geondp (id 23167) total_orders 11 → 12, `has_historic_orders=true`.

## Watch items

- **`wood565497@gmail.com` has a pre-existing NULL-line order** — `source_order_id 5729424867605`, 2024-02-22, $49.99, batch `terrorbytes_2026_05_27` — a header with no `historic_order_lines` rows. This is a stray from the original 27-May TerrorBytes import, **not** from this session (the wood565497 order I added is a separate 2024-03-02 $49.99 FPS upgrade). Worth a patch pass: any future "orders with zero lines" sweep should pick it up. Left untouched pending Mart's call.
- **Three same-product repeats included as distinct events:** akikazemoon, edukator.sp, eli.l.lrunescape each have an existing TerrorBytes digital order of the same product/price weeks earlier. The supplement orders have distinct timestamps (22–46 days apart) so they were treated as genuine repeat purchases, not duplicates. If a later review decides these are export artefacts rather than real second purchases, they're isolable by batch `terrorbytes_c12_2026_06_supplement`.
- **Live `historic_orders` is well ahead of V8's count** (76,861 on 18 June → 89,294 now). Several large imports happened between V8 and this session that aren't individually documented here. Reconcile against the live DB at session start, as always (V8 §5.9).

---
End — TerrorBytes C1+2 supplement, Creator VC OS, Supabase xwokhafcllstcnlcberv, 22 June 2026.
