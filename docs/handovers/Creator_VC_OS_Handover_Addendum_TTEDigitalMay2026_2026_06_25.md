**Creator VC OS**

**Handover Addendum — The Thing Expanded Digital Sale (May 2026) import + linkage**

| **Field** | **Value** |
| --- | --- |
| Session date | 25 June 2026 |
| Prepared by | Claude (claude.ai — Project: Creator VC OS) |
| Supabase project | xwokhafcllstcnlcberv (eu-west-2) — connector "Creator VC OS" |
| Supersedes | Extends rev 8 (18 June) + AE Flash addendum (25 June). A full rev 9 should fold both 25-June addenda in. |

## 0. Reconciliation note

Planned against the live DB, not the docs (per the standing rule). At session start: `historic_orders` = 114,102, 14 campaigns, customers 78,320, contacts 98,277, orphan backlog 1,688 — consistent with the AE Flash addendum end-state.

## 1. Import — The Thing Expanded Digital Sale (May 2026)

Source file from James (no accompanying note): `The_Thing_Expanded_Digital_Sale_May_2026`. Single Shopify line-item export, **digital only** (no shipping data — billing name + country only). Home campaign **1 (The Thing Expanded)**.

- **Batch:** `the_thing_expanded_digital_sale_may_2026`, `source_platform = shopify`, currency assumed **USD** (no currency column; US-majority buyers, the $29→$30.x spread on international orders is FX/fee variance on a flat $29 base).
- **Synthetic key:** `tte_dig_may26-{md5(lower(email)|paid_at|total)[:12]}`, idempotency-guarded by `NOT EXISTS` on `source_order_id`.
- **Window:** 2026-05-07 → 2026-05-26 (post-exclusion). **Inside the webhook era (≥ 2026-02-24)** — full overlap analysis run (§1.3).
- **Landed:** **1,474 orders / 1,575 lines / $47,519.77** gross.
- **Attribution:** single-line, home campaign 1, existing legacy codes (no decomposition — consistent with the AE Flash bundle treatment):
  - "The Thing Expanded - Digital Download" / "Digital Only" (blank SKU) → `THING-DIGITAL`, `resolver_method='name_map'` (1,472 lines)
  - "Digital Bundle" (`FILMOGRAPHY-DIGITAL-BUNDLE`) → `FILMOGRAPHY-DIGITAL-BUNDLE` (product 9, campaign 1), `resolver_method='sku_exact'` (103 lines)
  - Original SKU kept in line `payload.sku`; `payload.line_index` preserves intra-order line order.

### 1.1 Exclusions

- **4 orders / 5 rows** for `robin@creatorvc.com` (all 2026-05-06, sale-launch test orders) dropped. (`im@idwithin.com`: 0 present.)

### 1.2 Customers / contacts / linkage

All 1,474 orders carry an email, so linkage is **email-based** (no name/address matching needed):

- 1,471 distinct buyer emails. **+707 new customers** (78,320 → 79,027); 764 emails already had customers (flagged `has_historic_orders=true`).
- **+695 new contacts** (98,277 → 98,972), `marketing_consent=false`, `marketing_consent_source='legacy_customer_backfill'`, `bounce_state='none'`, linked `customer_id`. 776 emails already had contacts — left untouched (sticky-upwards consent).
- **1,474 junction rows** (`customer_historic_orders`), **1,474 `contact_sources`** (`source_type='historic_order_import'`, campaign 1), `contact_found` **1,474/1,474**.
- Aggregates refreshed for all 1,471 affected customers (bucketed `mod(id,4)`); dashboard + customer-list snapshots refreshed explicitly.

### 1.3 Overlap analysis — this sale ran OFF the webhook

The reason for the caution flag: the file window is fully inside the webhook era. Findings:

- **`raw_orders`:** only **78 rows** in the window (72 campaign-1 digital + 6 campaign-3 digital), vs the file's 1,478. The flat-$29 sale was **not** captured by the live webhook — it ran on a store/platform not wired to it. Only **5 emails** appear in both file and webhook window, and **none match on total** (file ≈ $29 sale price; webhook rows are regular-catalog digital at 17.99–47.99). Repeat buyers, not duplicates. **0 true webhook overlaps.**
- **`historic_orders`:** 155 rows in the window — 78 `gumroad_campaign_orders_legacy` (mirror of the webhook digital orders, timestamps matching to the second) + 77 untagged catalog-digital. None at the file's ~$29 price point; the only shared total value ($39.99, file = 1 order) had no email match. **0 true historic overlaps.**
- **`isod_orders`:** campaign 2 only — N/A.
- **Watch-item (carries the AE Flash §1.3 note):** the campaign-1 "(none)"/gumroad digital store overlaps these flash/digital files in *customer* space but not *order* space here, because the sale storefront is distinct from the webhook/gumroad store. The email+total multiplicity check held; no paid-at-drift collisions found at the $29 price band.

### 1.4 Emailless orphan re-match — no-op this round

Re-tested per §2 of the AE Flash addendum. This batch is **digital with zero shipping name/zip/street**, so it contributes no new name+zip / name+street keys to the addressable base, and the customer table gained only names (name-alone matching is disallowed). The 25-June pass already exhausted addressable matches. **Orphan backlog unchanged at 1,688.**

### 1.5 Migrations (in order)

`create_tte_digital_may2026_staging` → 2 chunk INSERT files pasted by Mart (993 + 582 rows) → `promote_tte_digital_may2026` (orders + lines, atomic) → `drop_tte_digital_may2026_staging` → `tte_dig_may26_build_customers` → `_flag_existing_customers` → `_build_contacts` → `_link_junction` → `_contact_sources` → `_set_contact_found` → `_refresh_aggregates_0..3` → dashboard + customer-list snapshot refresh.

## 2. Key numbers (live, end of session 25 June 2026 — second session)

| Metric | Value | Δ this import |
| --- | --- | --- |
| Customers | 79,027 | +707 |
| Contacts | 98,972 | +695 |
| raw_orders | 19,210 | — |
| historic_orders | 115,576 (contact_found false: 1,688) | +1,474 |
| historic_order_lines | 139,711 (0 NULL-campaign) | +1,575 |

## 3. Open / carried-forward items (unchanged from AE Flash addendum)

- **Currency assumption:** this batch stored as USD without an explicit currency column — revisit if any of these orders prove to be non-USD-settled.
- **Link-only durability (rev 8 §5.8):** 101 June-18 link-only resolutions still link-only; nothing new added this session.
- **ISOD consolidation (isod_orders → historic_orders):** still designed + gated.
- **campaign_orders / archive tables:** still pending DROP.
- **Remaining James files:** continue per the strict overlap protocol; for flash/digital files keep the email+amount±date overlap check.
- **GitHub MCP write still 403** — commit this addendum to `docs/handovers/` manually or via Claude Code, and update `NEXT.md`.
