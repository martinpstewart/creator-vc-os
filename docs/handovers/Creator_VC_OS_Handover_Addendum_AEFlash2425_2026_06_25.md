**Creator VC OS**

**Handover Addendum — ISOD/AE Flash Sale 2024–2025 import + orphan re-match**

| **Field** | **Value** |
| --- | --- |
| Session date | 25 June 2026 |
| Prepared by | Claude (claude.ai — Project: Creator VC OS) |
| Supabase project | xwokhafcllstcnlcberv (eu-west-2) — connector "Creator VC OS" |
| Supersedes | Extends rev 8 (18 June 2026). A full rev 9 should fold this in. |

## 0. Reconciliation note (important)

The rev 8 handover was materially behind the live DB at session start. Rev 8 records `historic_orders` = 76,861; the live count was **109,617**. A week of undocumented imports sat between rev 8 and this session: campaign 12 (ISOT Shopify 2022) was deleted and reattributed to campaign 9; campaign 4 renamed to "Aliens Expanded"; campaigns 14 (In Search of Darkness: 1990–1994) and 15 (SlasherTrash) were added; and several Shopify batches landed (`shopify_ae_2024_c2`, `AE_CE_2025`, `aliens_expanded_digital_2024`, `shopify_isod_9094_c1/_c2`, `slashertrash_c1_2025`, `shopify_isod_90s_digital_2026`, etc.). All planning this session was reconciled against the live DB, not the doc. **Future sessions must do the same before planning.**

## 1. Import — ISOD/AE Flash Sale 2024–2025 (campaign 1 storefront, multi-documentary)

Source file from James: `ISOD_AE_Flash_Sale_2425`. James' note: the period ran flash sales across AE, ISOD 80s and ISOD 90–94. The file is a single Shopify line-item export from the flash storefront; in practice it spans five home campaigns via cross-sell upsells.

- **Batch:** `shopify_isod_ae_flash_2024_2025`, `source_platform = shopify_legacy`, USD.
- **Synthetic key:** `aeflash2425-{md5(lower(email)|paid_at|order_total)[:12]}`, guarded by `ON CONFLICT (source_platform, source_order_id)`.
- **Window:** 2024-11-25 → 2025-04-20 (entirely pre-webhook; webhook era starts 2026-02-24, so no `raw_orders` overlap).
- **Landed:** 4,485 orders / 5,335 lines / **$254,533.43** gross (line subtotal).
- **Shipping:** the file's `Total` bundles shipping (same as the Part III C2 batch). Per §5.5, `gross_amount` = line subtotal; residual ($37,516.48 across 3,553 orders) stored in `historic_orders.shipping_amount`; raw `Total` kept in `payload.order_total`. Shipping excluded from all roll-ups.
- **Customers/contacts:** 4,158 distinct buyer emails (all now have customer + contact rows). New contacts created `marketing_consent=false`; pre-existing consented contacts left untouched (sticky-upwards). 4,485 junction rows, 4,485 `contact_sources` (`historic_order_import`), `contact_found` 4,485/4,485.

### 1.1 Attribution (Mart's decisions this session)

Lines attribute to each product's **home documentary campaign** (not the campaign-1 flash storefront), using **existing legacy codes** (no new products/variants created):

| File SKU | Home campaign | product_legacy_code used |
| --- | --- | --- |
| ALIENS-BLU-RAY-UPSELL | 4 (Aliens Expanded) | ALIENS-40TH-BLU-RAY |
| ISOD-TRILOGY-BLU-RAY-UPSELL | 8 (ISOD 80s) | ISOD-80S-TRILOGY-BLU-RAY (single line, no decomposition) |
| ISOD-90-94-BLU-RAY | 14 (ISOD 90–94) | ISOD-90S-STANDARD-BUNDLE |
| ISOD-90S-DIGITAL / STANDARD / DELUXE / PRODUCER | 14 | same code (direct) |
| ISOD-THREE-BLU-RAY-ONLY-UPSELL | 11 (Part III) | ISOD-PART-3-DIGITAL |
| ISODII-BLU-RAY_1 | 10 (Part II) | ISOD-PART-2-DIGITAL |

Per-campaign line revenue: 4 → $105,412.56 · 8 → $79,265.66 · 14 → $65,134.06 · 11 → $3,569.90 · 10 → $1,151.25. All lines carry real price (cross-sell add-ons use the Part III/AE-2022 real-price treatment, not $0). `resolver_method='aeflash2425_sku_map'`; original file SKU kept in line `payload.file_sku`.

Note the two ⚠ rows: the Part II/III physical upsells map to the only registered legacy codes for those documentary products (ids 12/13), which happen to be the `-DIGITAL` codes. Faithful "use existing codes" choice but the naming is a slight mismatch — revisit if a physical Part II/III variant is ever registered.

### 1.2 Exclusions

- **26 QA/test orders** dropped: `mohammad.kashif@reporteq.com` (22 orders) + `reporter969@gmail.com` (4). Rapid-fire $2,500–$5,000 "Producer/Exec Producer" tiers within minutes, billing city flipping New York↔London — ~$61k of fake revenue. (Decision: exclude.)
- **idwithin.xyz test lines** (22) dropped (`im@`, `aaron@` "SKU TEST", `signups@`). Same actor as the `im@idwithin.com` rule — treat the whole `idwithin` domain as test.
- **LOGO-*-90s t-shirt rows** dropped as line items ($0 size-selectors with no registered product). **Caution:** some LOGO rows were the *order header* carrying the order's `Paid at`/`Total` (e.g. a Deluxe bundle whose size row led). The build keeps the order + header attributes and drops only the LOGO line — do not drop LOGO header rows wholesale or you orphan the real line.
- **5 orphan $0 shirt lines** (email ≠ order header) dropped.
- **1 confirmed duplicate** dropped: `benjamin_spaulding2001@yahoo.com` 2024-12-12 $29.99 digital 90-94, already present in the campaign-1 "(none)" digital-store batch (order id 2264). It evaded the exact email+timestamp fingerprint by a ~5-minute paid-at/created-at drift between the two exports — see §1.3.

### 1.3 Overlap analysis (this batch is otherwise new)

Exact email+timestamp matches vs `historic_orders` window: 0. `isod_orders` in window: 0. `raw_orders` post-dates the file. The only true collision was benjamin (above), found by an email+amount match at ±2-day tolerance. **Watch-item:** the digital slice of flash storefronts can overlap the campaign-1 "(none)" digital store; the exact-timestamp fingerprint alone misses these due to paid-at vs created-at drift between exports — add an email+amount±date check when importing future flash/digital files.

### 1.4 Migrations (in order)

`aeflash2425_create_staging` → 13 chunk INSERT files pasted by Mart (one early run aborted on a `NaT` header bug → staging truncated and reloaded) → `aeflash2425_promote_orders` → `_promote_lines` → `_promote_customers` → `_promote_contacts` → `_promote_junction` → `_promote_contact_sources` → `_set_contact_found` → `_refresh_aggregates_0..5` → dashboard + customer-list snapshot refresh → `_drop_staging`.

## 2. Emailless orphan re-match pass (durable email-backfill)

Re-ran name+zip / name+street order-grain matching against the enlarged emailled-order base. Matching against the customer table yielded nothing (name-format mismatch); matching against emailled `historic_orders` on `shipping_name` worked.

- **13 orphans resolved** (single global email candidate across both methods). 4 ambiguous (2 distinct emails) skipped — including the known **Rachel Green** dedup pair.
- **Method: email-backfill (durable variant, §3.4)** — matched email written onto the order, junction added, `contact_found=true`, contact_source added, audit markers in payload (`contact_resolved_via`, `contact_matched_email`, `contact_resolved_batch='aeflash2425_followup_20260625'`). Chosen over link-only so the flag survives email-driven re-evaluation. All 13 matched emails already had customer + contact rows.
- Orphan backlog: **1,701 → 1,688.**
- Migrations: `aeflash2425_orphan_resolve_build` → `_orphan_backfill_email` → `_orphan_junction_and_flag` → `_orphan_contact_sources` → `_orphan_refresh_aggregates` → snapshot refresh → `_orphan_drop_staging`.

## 3. Key numbers (live, end of session 25 June 2026)

| Metric | Value |
| --- | --- |
| Customers | 78,320 |
| Contacts | 98,277 |
| raw_orders | 19,210 |
| historic_orders | 114,102 (contact_found false: 1,688) |
| historic_order_lines | 138,136 (0 NULL-campaign) |

## 4. Open / carried-forward items

- **Link-only durability (still open from rev 8 §5.8):** the 101 June-18 link-only resolutions remain link-only; this session used backfill, so no new link-only debt was added.
- **ISOD consolidation (isod_orders → historic_orders):** still designed + gated.
- **campaign_orders / archive tables:** still pending DROP.
- **Remaining James files:** continue per the strict overlap protocol; for flash/digital files add the email+amount±date overlap check (§1.3).
- **Part II/III physical legacy codes:** mapped to `-DIGITAL` product codes (§1.1) — optional cleanup if physical variants are registered.
- **GitHub MCP write still 403** — this addendum needs manual commit to `docs/handovers/` or via Claude Code; update `NEXT.md` accordingly.
