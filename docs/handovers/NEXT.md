# NEXT — Creator VC OS

**Supabase:** `xwokhafcllstcnlcberv` (eu-west-2) · connector **"Creator VC OS"** only
**Last updated:** 23 June 2026

---

## Last session (23 June 2026)
- **ISOD 95-99 Shopify Campaign 1 — NOT IMPORTED (duplicate).** File is the same 2025 Shopify store already live as **campaign 2 (`ISOD_95`)** in `isod_orders` (file = May 15–Jun 16 2025; isod runs to Nov 2025, 6,206 orders — more complete). Decision: archive, no import. Full record: `ISOD_9599_Duplicate_Decision_2026_06_23.md`.
- Read-only session, **no DB changes**.
- Connector note: "Creator VC OS" did not load on first `tool_search`; needed a toggle/retry. Verify with `current_database()` + a known count at the start of every session (multiple Supabase connectors share `mcp.supabase.com` — Tweakease / FreeFlight / Music-Hub are the wrong projects).

---

## Immediate / next imports
- **Remaining James master-index ingestions** — overlap-fingerprint **before** each (per import protocol). Check **all three order homes** — `isod_orders`, `raw_orders`, `historic_orders` — not just `historic_orders`+`source_file`. The 95-99 case proved the live DB can already hold an entire "new" file. Watch the recurring-franchise pattern (same documentary as crowdfunding + later Shopify = separate campaigns).
- **raw_orders era reminder:** webhook era is **2026-02-24 onward**. Pre-2026 Shopify files do not overlap raw_orders by date; the live dedup surface for them is `historic_orders` + `isod_orders`.

## Order-table consolidation programme
- **campaign_orders (Step 1, DONE):** DROP the three empty tables + scratch/archive tables next clean cycle.
- **isod_orders (Step 2, DESIGNED, GATED):** fold 6,206 orders / 8,117 lines into `historic_orders` (`source_platform='isod'`, batch `isod_1995_legacy`). Design: `ISOD_Consolidation_Design_2026_06_18.docx`.
  - **Gate:** Claude Code's `has_historic_orders` KPI-badge fix is deployed to prod but **uncommitted to git** — commit/push before Phase 1.
  - **Carry-in from 95-99 session:** camp 2 has **zero `products` rows**, and `isod_order_lines.line_sku` is NULL (SKUs in `sku_assigned`/`sku_after_correction`) with add-on/cross-sell lines un-priced. If richer SKU+price detail is ever wanted for camp 2, that's an **enrichment** pass from the 95-99 file — not a re-import.

## Data & provenance
- **Emailless link-only flag durability:** 101 link-only resolutions — make `contact_found` recheck marker-aware (`payload.contact_resolved_via='name_zip_match'`) **or** backfill matched emails. Until then an email-driven recheck could revert the flag (junction/aggregates safe).
- **Remaining emailless:** ~1,709 (5 ambiguous; rest no counterpart). Fuzzier matching only (partial name / address-line / zip-prefix). Re-run name+zip / name+street sweep opportunistically after each large customer-adding import.
- **Campaign 13 (Shelby Oaks):** contacts-only (~13k), no orders/products — confirm provenance.
- **shipping_amount:** populated for `shopify_isod3_part3_2022_c2` only; backfill earlier batches from payload if shipping reporting wanted.
- **Customer-dedup candidate:** Rachel Green pair (customers 66684 / 66685).

## Build / platform
- **Email sending:** Amazon SES + Unlayer (Project 286722) replacing Omnisend; `aa_03_marketing` ready. Microsites V2 (consent + double opt-in). CSV ingestion tool for James's historic data.
- **Freshdesk:** "Ticket Updates" automation rule; Film→campaign mapping; historical XML backfill (~127 files); migrate off Robin's personal API key.
- **Dashboard RPC bucket-label fix:** `shopify_legacy` currently routing into the `shopify` KPI bucket.
- **`refresh_dashboard_snapshot()`:** genuine aggregation builder still to locate/restore from migration history (current fn is a self-copying no-op).
- **Handover items:** Vercel project transfer to Robin; replace `payhere_secret` (Mart's personal key) with a service key.
- **GitHub write access:** still 403 (`Contents: write` not granted on `martinpstewart/creator-vc-os`). Handover commits manual or via Claude Code until fixed.

---
*Confidential — V88 / Creator VC OS · Supabase `xwokhafcllstcnlcberv`*
