# Creator VC OS — Session 2026-06-23

## SlasherTrash Shopify Campaign 1 — new campaign 15 (import)

**Supabase:** `xwokhafcllstcnlcberv` (eu-west-2) · connector **"Creator VC OS"** only
**Prepared by:** Claude (claude.ai — Project: Creator VC OS)

---

### 1. Summary

Imported the SlasherTrash Shopify Campaign 1 export (standard Shopify line-item format) into a
**new campaign 15 (`SlasherTrash` / `SLASHERTRASH_DOC`)**. Clean first import — no overlap with
`raw_orders` (store never on the live webhook; SlasherTrash window 24 Jul–21 Aug 2025 predates the
2026-02-24 webhook era) or `historic_orders` (no prior slasher batch).

- **3,484 file rows → 2,894 orders.** Excluded 2 `robin@creatorvc.com` test orders (6 lines).
- **Net imported: 2,892 orders / 3,478 lines / $254,979.67**, 24 Jul–21 Aug 2025, USD, no FX.
- Per-order `Total` = sum of its lines for all 2,892 orders (0 discrepancies) → `gross_amount = Total`,
  no shipping residual (unlike the Part III C2 batch).
- Keys: `source_platform = shopify_legacy`, batch `slashertrash_c1_2025`,
  `source_order_id = slasher-c1-NNNN`.

### 2. Products (new, ids 143–148, all campaign 15)

| id | legacy_code | Name | requires_address |
|----|-------------|------|------------------|
| 143 | SLASHER-TRASH-DIGITAL | Slasher Trash - Digital Bundle | false |
| 144 | SLASHER-TRASH-COLLECTORS | Slasher Trash - Collector's Edition Blu-ray | true |
| 145 | SLASHER-TRASH-DELUXE | Slasher Trash - Deluxe Collector's Edition Blu-ray + T-Shirt | true |
| 146 | SLASHER-TRASH-PRODUCER | Slasher Trash - Producer | true |
| 147 | SLASHER-TEE | Slasher Trash T-Shirt | true |
| 148 | DIGITAL-BUNDLE-CVC-FILMOGRAPHY | Digital Bundle (CVC Filmography) | false |

- **Producer**: one SKU covers two tiers — Associate Producer ($1,250 ×3) and Producer ($2,500 ×1);
  tier + price recorded in the line `payload` (Option-A style).
- **T-shirts**: six sizes (S–XXXL, 276 u, all $0) collapsed to one product `SLASHER-TEE`; the size is
  recorded in the line `payload.orig_sku` / `name`.
- **DIGITAL-BUNDLE-CVC-FILMOGRAPHY** (39 u): pan-filmography digital bundle, no single-doc home —
  Mart's decision: new product homed on campaign 15 (the selling campaign).

### 3. Line attribution (cross-sells routed to home-campaign products, real price)

| Campaign | Lines | Units | Line rev | Product / note |
|----------|-------|-------|----------|----------------|
| 15 SlasherTrash | 3,192 | 3,204 | $242,410.98 | tiers 143–146 + tee 147 + filmography bundle 148 |
| 8 ISOD 80s | 99 | 101 | $4,048.39 | FNG16097 → product 140 (existing) |
| 14 ISOD 90-94 | 83 | 85 | $4,263.36 | ISOD-90s-HORROR-BLU-RAY → product 141 (existing) |
| 9 ISOT | 68 | 70 | $2,811.12 | ISOT-BLU-RAY-NP → product 142 (existing; literal SKU home, **not** the Part III C2 camp-12 remap) |
| 4 Aliens Expanded | 36 | 36 | $1,445.82 | ALIENS-BLU-RAY → remapped `product_legacy_code` to existing `BLU-RAY-PACKAGE` (product 117); no new product (Mart) |

Reconciles to 3,478 lines / $254,979.67.

### 4. Customers / contacts / junction (deltas)

- **+543 new customers** (2,333 of 2,876 distinct emails already existed). Email stored lowercased;
  case-insensitive (`lower()`) NOT EXISTS guard against the case-sensitive `customers_email_key`.
- **+531 new contacts** (`marketing_consent = false` — Shopify checkout is not a marketing opt-in;
  existing contacts left untouched, per the ISOT precedent). Linked to `customer_id`.
- **+2,892 `customer_historic_orders`** (max 1 link/order — double-count probe clean).
- **+2,892 `contact_sources`** (`historic_order_import`, campaign 15, one per order).
- Affected customers (2,876) re-aggregated; `has_historic_orders` set true on all, 0 with zero orders.
  Dashboard + customer-list snapshots refreshed.

### 5. Emailless orphan re-match (opportunistic, this session)

The 543 new customers widened the resolver pool. A name + zip / name + street sweep restricted to
SlasherTrash buyers (single-candidate only, never name alone) found **exactly one** durable resolution:

- **Order 9569** (Kickstarter `isod80s-1096`, "Kevin Young", Charleston, zip 29412) matched
  SlasherTrash buyer `y.kevin.young@gmail.com` on **both zip and street**. Email **backfilled** onto the
  order (durable per §5.8), junction linked, `contact_found=true`, `historic_order_import` contact_source
  added (`contact_resolved_via=name_zip_street_match`, batch `slashertrash_c1_followup_20260623`),
  customer re-aggregated.
- **Emailless backlog: 1,705 → 1,704.** The other ~1,704 gained nothing from this import.

### 6. Migrations (in order)

`slashertrash_c1_seed_and_staging` → (7 chunk files pasted into the SQL editor by Mart) →
`slashertrash_c1_p1_orders` → `_p2_lines` → `_p3_customers` → `_p4_junction` → `_p5_contacts` →
`_p6_contact_sources` → `_p7_refresh_mod0/1/2` → `_snapshot_refresh` → `_drop_staging` →
`slashertrash_c1_orphan_9569_resolve`.

All promotion steps idempotent (orders `ON CONFLICT (source_platform, source_order_id)`; lines
DELETE-then-INSERT on the slasher orders; customers/junction/contacts/contact_sources NOT EXISTS guards).

### 7. Live state after session

- campaigns max id **15**; products max id **148**.
- `historic_orders` 103,346 → **106,238** (+2,892).
- Campaign 15 (SlasherTrash): 6 products, 3,192 historic lines, $242,410.98.
- Emailless `contact_found=false`: **1,704**.

---
*Confidential — V88 / Creator VC OS · Supabase `xwokhafcllstcnlcberv`*
