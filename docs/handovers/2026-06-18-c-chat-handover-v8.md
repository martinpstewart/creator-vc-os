# C Chat handover, revision 8

_Source: `Creator_VC_OS_Handover_2026_06_18_v8.docx` at repo root. This is the canonical markdown copy; the .docx is the human-facing export. Written by C Chat (claude.ai)._

| Field | Value |
|---|---|
| Prepared for | New Claude session (handover) |
| Prepared by | Claude (claude.ai — Project: Creator VC OS) |
| Original date | 28 April 2026 |
| Last updated | 18 June 2026 (rev 8) — supersedes the 18 June rev 7 handover |
| Supabase Project ID | xwokhafcllstcnlcberv (eu-west-2) |
| Primary contact | Martin (Mart) — V88 agency |
| Collaborator | Robin (robin@creatorvc.com) |
| MCP connector | "Creator VC OS" — use exclusively; never another Supabase connector |

**Note on this revision.** Rev 8, this session: (1) imported the ISOD 80s Part III "Campaign 2" Shopify export as a second Part III batch under campaign 11 (4,857 orders / 10,077 lines; shipping handling diverged from the 2021 batch — §3.1, §5.5); (2) ran a name+zip resolution pass over emailless orders against the now-larger base, resolving 101 (orphans 1,810 → 1,709 — §3.2). A dedicated addendum (`Creator_VC_OS_Handover_Addendum_ISOD3_C2_2026_06_18.docx`) details both. Carried forward from rev 7: the AE "Campaign 1 Sept 2022" import (§3.3), the earlier orphan re-match (§3.4), the ISOT 2022/flash imports, FPS imports, campaign_orders retirement, snapshot read-path, and the gated ISOD consolidation. Registry, products and totals below are reconciled against the live DB on 18 June 2026.

## 1. Project overview

Creator VC OS is a Supabase-backed data system consolidating customer, backer, order, support and marketing data across nearly a decade of Creator VC documentary campaigns. Shopify is the live commerce layer (orders arrive via webhook). Wix, Gumroad, CrowdOx/Kickstarter/Indiegogo and legacy Shopify exports are historical sources that have been imported. The front-end is a PWA built in Claude Code; Freshdesk is the support system of record, mirrored read-only into Supabase. Supabase is the sole backend.

Order homes (current): `raw_orders` (live Shopify) + `historic_orders` (all non-webhook imports) + `isod_orders` (the last standalone legacy store, campaign 2). `campaign_orders` was retired (rev 5). `isod_orders` is slated to fold into `historic_orders` next (design ready, gated — §7). Campaign 4 spans TWO homes: the live 2026 store in `raw_orders` and the original 2022 store in `historic_orders` — separated by era, verified non-overlapping. Campaign 11 (Part III) now has TWO historic batches (2021 + 2022 "Campaign 2"), also verified non-overlapping.

### 1.1 Tech stack

| Layer | Technology |
|---|---|
| Frontend | Claude Code PWA (creator-vc-os.vercel.app) |
| Backend / DB | Supabase (PostgreSQL), project xwokhafcllstcnlcberv, eu-west-2 |
| Live commerce | Shopify (single store creatorvc.myshopify.com) via shopify-webhook |
| Historic commerce | Wix, Gumroad, legacy Shopify (`shopify_legacy`), Shopify (Feb 2022 + Jul 2022 ISOT stores), CrowdOx/Kickstarter/Indiegogo |
| Support | Freshdesk (creatorvc.freshdesk.com, Forest plan) — read-only mirror in `aa_04_support` |
| Email (in build) | Amazon SES + Unlayer (templates + microsites) |
| NL query | `nl-query` Edge Function for Robin's team |

### 1.2 Key people

| Person | Role |
|---|---|
| Martin (Mart) | Lead developer / project owner (V88 agency) |
| Robin | Creator VC client / stakeholder / end user |
| James | Provides historical CSV exports (CrowdOx etc.) |
| Aaron | Shopify store / Acutrack SKU agreements; supplied Campaign 1 Part 1 data |

## 2. Supabase architecture

Four custom schemas. Always chain `.schema()` explicitly — bare table references fail silently.

| Schema | Purpose |
|---|---|
| `aa_01_campaigns` | Orders / products / campaigns (source of truth). `raw_orders` (live Shopify), `historic_orders` + `historic_order_lines` (all non-webhook imports), `isod_orders` + `isod_order_lines` (standalone, campaign 2), products, variants, mapping tables, `v_raw_order_line_attribution`, `v_all_orders`. `campaign_orders` / `campaign_order_lines` RETIRED (empty, pending DROP). |
| `aa_02_crm` | Customers + order junctions (`customer_raw_orders`, `customer_isod_orders`, `customer_historic_orders`), `customer_summary` view, `dashboard_snapshot` + `customer_list_snapshot` (§2.2). `customer_campaign_orders` RETIRED (empty). |
| `aa_03_marketing` | `contacts`, `contact_sources`, `segments`, email_templates/sends, microsites, `v_contact_campaign_engagement`. |
| `aa_04_support` | Freshdesk read-only mirror (`tickets`, `ticket_events`). NEVER exposed to Data API — all I/O via public SECURITY DEFINER RPCs. |

### 2.1 Campaign registry (live, 18 June 2026 rev 8)

| ID | Name | Legacy code | Notes |
|---|---|---|---|
| 1 | The Thing Expanded | `TT_EXPANDED` | Part 1 (Aaron CSV) + Part 2 (Shopify). Reopened May 2026 digital-only. 13 products, 4,479 historic lines (incl. 404 migrated Gumroad). |
| 2 | In Search of Darkness 1995 | `ISOD_95` | Lives ONLY in `isod_orders` (6,206 orders / 8,117 lines, $573,877.10). Consolidation designed + gated (§7). |
| 3 | FPS: First Person Shooter | `FPS_DOC` | Gumroad + legacy-Shopify cross-sell + CrowdOx/KS/IGG. 2,703 historic orders, 3,466 lines, 12 products. |
| 4 | Aliens Expanded 40th Anniversary | `ALIENS_EXPANDED` | TWO homes: live 2026 store in `raw_orders` AND original 2022 store in `historic_orders` (batch `shopify_ae_2022`, 2,753 orders / $328,807). 7 products. 2,751 historic lines. |
| 5 | TerrorBytes | `TERRORBYTES_DOC` | Legacy Shopify import. 3,720 lines, 10 products. |
| 6 | In Search of the Last Action Heroes | `ISOTLAH_DOC` | KS/IGG import. 7 products, 1,295 lines. |
| 7 | In Search Of Darkness 70s | `isod-70s` | 4 products. |
| 8 | In Search of Darkness 80's | `ISOD_80S` | ISOD Part I. 16 products. 31,770 historic lines (incl. Part III + Part III C2 + ISOT-2022 + ISOT-flash + AE-2022 Blu-ray cross-sells). |
| 9 | In Search of Tomorrow | `ISOT_DOC` | CrowdOx/KS/IGG, 8,414 orders. 7 products. 8,564 historic lines. |
| 10 | In Search of Darkness: Part II | `ISOD_PART2` | 26 products. 17,561 historic lines (incl. Part III C2 + other cross-sells). |
| 11 | In Search of Darkness: Part III | `ISOD_PART3` | TWO historic batches: 2021 (`shopify_isod3_part3_2021`, 6,876) + 2022 "Campaign 2" (`shopify_isod3_part3_2022_c2`, 4,857). 11 products. 15,852 historic lines. Part I/II cross-sells to camps 8/10; ISOT/orig-ISOD add-ons to camps 12/8 (§3.1). |
| 12 | In Search of Tomorrow (Shopify 2022) | `ISOT_SHOPIFY_2022` | ISOT post-campaign Shopify. Feb–Mar 2022 store + Jul–Aug 2022 flash sale + Part III C2 ISOT add-on. 7 products. 5,753 lines. Same franchise as 9 (§5.10). |
| 13 | Shelby Oaks | `SHELBY_OAKS` | Contacts-only marketing audience (Omnisend ~13k). No orders / no products yet — provenance to confirm (§7). |

Note: `legacy_code` casing is inconsistent (e.g. `isod-70s` vs `ISOD_80S`). `campaigns` uses a quoted `"Name"` column (capital N) — always double-quote. `campaigns.id` and `products.id` have no identity default (assign manually; current max product id 122); historic/customer/contact tables use GENERATED identity (§5.6). Campaigns 9 and 12 are the same documentary run as separate campaigns (§5.10).

### 2.2 Read-path: snapshot tables

`/dashboard` and `/customers` do not compute on read. They SELECT from two denormalised snapshot tables in `aa_02_crm`, refreshed by `pg_cron` (5 min / 10 min). New imports do NOT appear on those screens until the next cron tick OR until the refresh procs are called manually (§5.3). Import work itself is unaffected — canonical tables are written normally; only the read screens lag.

| Object | Type | Notes |
|---|---|---|
| `aa_02_crm.dashboard_snapshot` | table | Single `jsonb` row (id=1). Cron job 4, every 5 min. |
| `aa_02_crm.customer_list_snapshot` | table | Mirrors `get_customers_list` shape; GIN indexes on `campaign_ids`, `source_platforms`, `search_text` trigram. Cron job 5, every 10 min. |
| `home_dashboard_impl()` | fn | Thin SELECT against `dashboard_snapshot`. |
| `get_customers_list()` | fn | Thin paginated SELECT against `customer_list_snapshot`. |
| `public.refresh_dashboard_snapshot()` | RPC | Admin-callable. Rebuilds dashboard snapshot in a txn (~7s). |
| `public.refresh_customer_list_snapshot()` | RPC | Admin-callable. Rebuilds customer-list snapshot in a txn (~15s). Reads `customer_summary`; paying gate via `v_paying_customer_emails`. |

Caveat: the dashboard buckets know `shopify / shopify_legacy / gumroad / wix / indiegogo / kickstarter` (`crowdox` rolls into Other). Before adding any BRAND-NEW `source_platform`, locate the actual compute path rather than trusting a function name. `shipping_amount` (new this rev) is NOT in any bucket by design (§5.5).

**Do NOT:** disable cron jobs 4/5 (freezes the screens); TRUNCATE the snapshot tables outside the refresh procs.

## 3. Historic imports

### 3.1 ISOD Part III "Campaign 2" — campaign 11 (this session)

Second ISOD Part III Shopify export imported alongside the 2021 batch. 6,103 rows → 4,857 orders (Shopify line-item format; new order per non-blank `Paid at`). `source_platform=shopify_legacy`, batch `shopify_isod3_part3_2022_c2`, synthetic `source_order_id` `isod3-part3-c2-NNNN` (own namespace). USD. No overlap with the 2021 batch — exact / (email,paid_at) / (email,same-day) collisions all 0 despite overlapping date windows; 721 shared emails are returning buyers.

Tiers/add-ons — "same as Campaign 1" only partly. 12 SKUs were new to C2 (full-price Elvira/Corey edition bundles, DVD variants, cross-sell Blu-rays for ISOT/ISOD II/orig ISOD). All resolved to EXISTING products — zero new products. Decisions (Mart): ISOT add-on → campaign 12 (`ISOT2022-BLURAY`); original ISOD ("ISOD 1", no part suffix) → campaign 8 edition products; full-edition Elvira/Corey bundles → base tier with edition in line payload (Option A); trilogy decomposition components stay standard (`ISOD80S-BLURAY` camp 8 + `ISOD2-BLURAY` camp 10, $0).

Shipping — divergence from the 2021 batch. The 2021 Total equalled lineitem subtotal exactly; C2's Total bundles flat-rate shipping ($10.55–$21/order, $60,017.65 total). Per Mart, shipping is excluded from all roll-ups: `gross_amount = subtotal` ($480,072.55 = summed line revenue); new nullable column `historic_orders.shipping_amount` holds the residual (this batch only). Raw Total kept in `payload.order_total`.

Result: +4,857 `historic_orders` (paid, `contact_found=true`); +10,077 lines (6,103 base + 3,974 trilogy synth). Line revenue — 11 $465,356.23 · 10 $4,718.82 · 12 $8,677.83 · 8 $1,319.67. +1,550 customers · +1,452 contacts · +4,857 junction · +4,857 contact_sources (`historic_order_import`, campaign 11). Migrations: `isod3_c2_seed_shipping_col_and_staging` → 22 chunk files pasted by Mart → `isod3_c2_promote` → `isod3_c2_refresh_aggregates_0..5` → `isod3_c2_refresh_list_snapshot` → `isod3_c2_drop_staging`.

### 3.2 Emailless orphan resolution — name + zip (this session, 101 resolved)

Re-ran name+zip matching against the now-larger base. Of 1,810 emailless `contact_found=false` orders, 1,793 had name+zip; 106 matched an emailled order under normalised matching (name whitespace collapsed, zip stripped of non-alphanumerics incl ZIP+4 hyphens — looser than the earlier strict-exact pass). 101 unambiguous (single email), 5 ambiguous (skipped). 14 were resolvable only via the new C2 data; the other 87 matched pre-existing data the earlier pass missed.

Applied (all 101, Mart's choice): LINK-ONLY — `customer_historic_orders` junction + `contact_found=true` + payload audit (`contact_resolved_via=name_zip_match`, `contact_matched_email`, `contact_resolved_batch=isod3_c2_followup_20260618`). Email NOT backfilled (differs from §3.4 / §5.8 — see watch item). 101 orders → 97 customers re-aggregated; snapshot rebuilt. Orphans 1,810 → 1,709. Migrations: `emailless_name_zip_resolve_followup` → `emailless_resolve_snapshot_refresh`.

### 3.3 Aliens Expanded — "AE Campaign 1 Sept 2022" — campaign 4 (rev 7)

Original AE store export (orders 6 Sep 2022 – 31 Mar 2023). 3,018 rows → 2,753 orders, USD, gross $328,807.00. `source_platform=shopify_legacy`, batch `shopify_ae_2022`, synthetic key `ae2022-{md5(email|paid_at|total)[:12]}`. Proven zero duplicates against the canonical union. New campaign-4 products ids 117–122 (2022 tiers). Cross-sells carried real price (Part III treatment): ISOT $35×70 → camp 9; ISOD I $25×52 → camp 8; ISOD II $25×65 → camp 10; the $60 "ISOT & ISOD I/II" bundle split into $0 component lines (`bundle_component_synth`). +2,753 historic_orders; +3,178 lines; +964 customers; +781 contacts; +2,753 contact_sources.

### 3.4 Blank-email orphan re-match — rev 7 (13 resolved)

Normalised name + full street address sweep against the larger base after AE-2022. 13 orders resolved to 11 customers; 4 ambiguous left untouched. Mechanics differed from §3.2: the matched email was BACKFILLED onto the order (so `contact_found` survives email-driven re-evaluation), plus junction, `contact_found=true`, and a `contact_source` (batch `orphan_rematch_namaddr_2026_06_18`). Orphans 1,823 → 1,810.

### 3.5 Earlier imports (carried forward)

ISOT Flash Sale July 2022 — campaign 12: 1,321 orders, $80,129 (batch `shopify_isot_flash_2022_jul`). ISOT Shopify 2022 — campaign 12: 4,215 orders / 4,229 lines, $325,727.20 (batch `shopify_isot_2022`).

ISOD Part III — campaign 11: 6,876 orders (batch `shopify_isod3_part3_2021`); Part I/II cross-sells to camps 8/10. FPS CrowdOx/IGG April 2022 — campaign 3: 1,007 (`fps_crowdox_ig_2022`). FPS CrowdOx/KS June 2021 (`fps_crowdox_ks_2021`, 1,696).

ISOD 80s Part 1 & 2 main Shopify; flash sales (2020/2021). ISOT crowdfunding (camp 9, 8,414, KS/IGG GBP@1.24). ISOTLAH (6) / ISOD 70s (7) / ISOD 80s base (8) KS/IGG GBP@1.33. TerrorBytes (5). Wix (130) + Gumroad (4,445). CrowdOx/ISOD legacy (camp 2, `isod_orders`). `campaign_orders` retirement migrated 429 Gumroad orders to historic.

Duplicate-safety pattern: email + exact-timestamp + gross fingerprint, swept per-batch and vs raw_orders, before every import. `ON CONFLICT (source_platform, source_order_id)` guards re-runs.

## 4. Edge functions & support

- **shopify-webhook (v28):** live Shopify ingestion → `raw_orders`. Two-layer routing (`shop_domain`, then order-number suffix). Derives `is_digital_only` / `has_digital`. Upserts contacts + contact_sources (`shopify_checkout_optin`).
- **freshdesk-webhook (v8) + freshdesk-poll (hourly cron):** both write the `aa_04_support` mirror via the shared service_role RPC `freshdesk_ingest` (schema never exposed to Data API). Read RPCs `tickets_list` / `customer_tickets` / `ticket_get` are staff-gated. `freshdesk_secret` is Robin's personal key — flagged for a dedicated service key.
- **Deploy note:** the `deploy_edge_function` MCP tool is unreliable on this project — deploy via Supabase Dashboard paste (`nl-query`, `gumroad-webhook`, `shipping-recalc`, `freshdesk-*`).

## 5. Operational rules — critical

### 5.1 Database change protocol (strict)

1. Investigate read-only first (`execute_sql`).
2. Present a plan with dry-run row counts; wait for explicit approval ("yes" / "run" / "go"). Present decisions one at a time.
3. Execute writes/DDL via `apply_migration` only (`execute_sql` writes do not persist; RPCs called via `SELECT` do commit — used for the snapshot refreshes).
4. Verify after writing against the dry-run numbers. Timeout ≠ rollback: if `apply_migration` errors/times out, check actual row counts before any retry.

### 5.2 Connector, schema access & canonical union

Use the "Creator VC OS" connector exclusively. Verify at session start with `SELECT current_database()` + a known count.

Chain `.schema('aa_01_campaigns' | 'aa_02_crm' | 'aa_03_marketing')`. `aa_04_support` is never exposed — route via public RPCs. `execute_sql` returns only the LAST statement's result — use `UNION ALL` or separate calls.

Canonical order union = `raw_orders + historic_orders + isod_orders` ONLY. `campaign_orders` is retired (empty). `v_all_orders` is the order-grain unified view (102,163 rows).

### 5.3 Large imports

`apply_migration` seeds campaign/products + creates persistent `public._*_staging` tables → chunked `INSERT VALUES` files (~150–250 KB each) pasted into the SQL editor by Mart → promotion (prefer several smaller idempotent migrations) moves staging → canonical → bulk aggregate refresh split by `mod(id,N)` → DROP staging. Quote text SKU columns. Scan vendor CSVs for a trailing "Totals" row; treat round-number counts as suspicious. For cross-sell lines, remap `product_legacy_code` to the target product's existing `legacy_code`. Always check whether the source "Total" includes shipping/tax (Part III C2 did, the 2021 batch did not — §5.5).

**Post-import (snapshot read-path):** after a batch lands, run `SELECT public.refresh_dashboard_snapshot();` and `SELECT public.refresh_customer_list_snapshot();`. If the batch introduces a brand-new `source_platform`, update the dashboard compute path BEFORE refreshing.

### 5.4 RPC grants & views

Every `CREATE OR REPLACE` on a `public.*` RPC must re-`GRANT EXECUTE TO anon, authenticated` (and `service_role` where used) in the same migration, or app screens break.

`CREATE OR REPLACE VIEW` only adds columns at the end; mid-list changes need DROP + CREATE (check `pg_depend` first).

### 5.5 Currency / FX & shipping convention

`historic_orders.gross_amount` is USD; native amount + currency + fx_rate + fx_basis live in payload. Kickstarter / Indiegogo are GBP-native (ISOD 80s 2018 @1.33; ISOT 2020–22 @1.24; FPS @1.38). Shopify / Gumroad / Wix / CrowdOx are USD.

**Shipping (new this rev):** `gross_amount` excludes shipping; it is the lineitem subtotal. Where a Shopify export's "Total" includes shipping (Part III C2), the residual is stored in the nullable `historic_orders.shipping_amount` column and the raw Total in `payload.order_total`. `shipping_amount` is excluded from every roll-up (dashboard, campaign attribution, customer total_spend) by design — Robin does not want shipping in the dashboard at present. Only `shopify_isod3_part3_2022_c2` is populated; other batches are NULL and can be backfilled later if needed.

### 5.6 Identity columns

`campaigns` and `products` have NO identity default — assign id manually (current max product id 122). `historic_orders`, `historic_order_lines`, `customers`, `contacts`, `contact_sources`, `customer_historic_orders` are GENERATED identity — omit id on insert; joins use natural keys (`source_platform+source_order_id`; email). `customers` & `contacts` are UNIQUE(email) (email lower+trimmed; `contacts.email` is citext). `contact_sources` for historic orders use `source_type='historic_order_import'` with `source_historic_order_id` set (CHECK `contact_sources_fk_matches_type`).

### 5.7 Cross-sell attribution (confirmed with Mart)

A product reports to its own campaign by SKU, regardless of which sale it is bought in. `historic_order_lines.campaign_id` = the product's campaign (not the order's). The order stays whole (full gross at the header); each line lands on its product's campaign. Per-import treatment: real-price cross-sell add-ons (Part III, AE-2022) or $0 attribution-only; bundle components with no itemised price are $0 unit-lines (resolver `bundle_component_synth`). No line at `campaign_id NULL` (verified 0). Note: $0 synth bundle-component lines DO count in `customers.total_line_items` / `total_quantity_purchased` (consistent across batches).

### 5.8 contact_found semantics

`contact_found=true` ⇔ a customer/contact exists for the email AND is linked in `customer_historic_orders`. Set it AFTER creating new customers in a promotion (email-driven, re-evaluated against email).

Two orphan-resolution variants now exist: (a) name + street/zip with the matched email BACKFILLED onto the order (§3.4) — flag survives email-driven re-evaluation; (b) name + zip LINK-ONLY (§3.2, this session, Mart's choice) — junction + flag + payload markers, NO email written. Variant (b)'s junction/aggregates are permanent, but its `contact_found` flag would NOT survive an email-driven recheck (the order is still emailless). Any future recheck should treat `payload.contact_resolved_via='name_zip_match'` as `contact_found=true`, or those 101 should be backfilled. 1,709 orphans remain false (mostly no customer counterpart at all).

### 5.9 Communication

Mart is terse and directive (confirms with "yes" / "run" / "go"). Present decisions one at a time; once approved, proceed without elaboration. The live DB routinely runs ahead of this doc — reconcile registry, products and counts against the database at the start of every session before planning.

### 5.10 Recurring franchises

The same documentary can run as more than one campaign (crowdfunding + later Shopify store) — modelled as separate campaigns with their own products (ISOT = campaign 9 + campaign 12). A related pattern exists on campaign 4 and now campaign 11: one campaign with multiple homes/batches across non-overlapping eras. Live watch-item: a webhook cannot know which of two same-franchise campaigns an incoming order belongs to — a parent-franchise tag/reattribution step is needed before any franchise is live under two campaigns at once.

## 6. Key numbers (live, 18 June 2026 rev 8)

| Metric | Value |
|---|---|
| Customers | 61,191 |
| Contacts | 81,663 (38,671 consented & reachable; 177 unsubscribed) |
| `raw_orders` (live Shopify) | 19,096 |
| `historic_orders` | 76,861 (contact_found: 75,152 true / 1,709 false) |
| `historic_order_lines` | 95,211 (no NULL-campaign lines) |
| `isod_orders` (standalone, campaign 2) | 6,206 orders / 8,117 lines / $573,877.10 — consolidation designed + gated |
| `campaign_orders` | 0 (RETIRED — empty tables + archive pending DROP) |
| `v_all_orders` | 102,163 |

`historic_orders` by platform (paid orders / gross USD):

| Platform | Orders | Paid gross (USD) |
|---|---|---|
| kickstarter | 7,882 | $868,500.27 |
| indiegogo | 6,450 | $672,348.91 |
| shopify_legacy | 50,238 | $3,937,603.88 |
| shopify (live + ISOT 2022 + flash) | 5,536 | $429,506.20 |
| gumroad | 4,854 | $104,436.25 |
| crowdox | 1,677 | $166,732.84 |
| wix | 129 | $6,286.69 |

`shopify_legacy` batches: `isod80s_part1` 16,108 | `isod80s_part2` 10,766 | `isod3_part3` (2021) 6,876 | `isod3_part3_2022_c2` 4,857 (NEW) | TerrorBytes 3,705 | `shopify_ae_2022` 2,753 | `isod80s_flashsale_2020` 2,684 | `isod2_flashsale_2021` 2,492. `shopify` batches: `shopify_isot_2022` 4,215 | `shopify_isot_flash_2022_jul` 1,321.

`historic_order_lines` by campaign: 1 → 4,479 | 3 → 3,466 | 4 → 2,751 | 5 → 3,720 | 6 → 1,295 | 8 → 31,770 | 9 → 8,564 | 10 → 17,561 | 11 → 15,852 | 12 → 5,753.

Products per campaign: 1 → 13 | 3 → 12 | 4 → 7 | 5 → 10 | 6 → 7 | 7 → 4 | 8 → 16 | 9 → 7 | 10 → 26 | 11 → 11 | 12 → 7. (Part III C2 added no new products.)

## 7. Outstanding / on the horizon

**Order-table consolidation programme**

- `campaign_orders` (Step 1, DONE): DROP the three empty tables plus the scratch/archive tables next clean cycle.
- `isod_orders` (Step 2, DESIGNED, GATED): fold the 6,206 isod orders / 8,117 lines into `historic_orders` (`source_platform='isod'`, batch `isod_1995_legacy`). Design doc: `ISOD_Consolidation_Design_2026_06_18.docx`.
- ISOD execution gate: Claude Code's `has_historic_orders` KPI-badge fix is DEPLOYED to prod but UNCOMMITTED to git — commit/push pending before Phase 1.

> _Note from Claude Code 18 Jun 2026: this gate is now cleared — badge fix is committed at `5e54f4f` on origin/main. ISOD Phase 1 is unblocked. See NEXT.md._

**Data & provenance**

- **Emailless link-only flag durability (NEW):** the 101 §3.2 resolutions are link-only — decide whether to (a) make any `contact_found` recheck marker-aware (`payload.contact_resolved_via='name_zip_match'`), or (b) backfill their matched emails. Until then, an email-driven recheck could revert their flag (junction/aggregates are safe).
- Campaign 13 (Shelby Oaks): contacts-only marketing audience (~13k); no orders/products. Confirm provenance.
- Remaining emailless: 1,709 (5 ambiguous; rest have no counterpart). Fuzzier matching (partial name, address-line, zip-prefix), not another exact pass. Re-run the name+zip / name+street sweep opportunistically after each large customer-adding import.
- `shipping_amount`: populated for `shopify_isod3_part3_2022_c2` only; backfill earlier batches from payload if Robin ever wants shipping reporting.
- Remaining historic ingestions from James's master index — overlap fingerprint per §3.5 before each; watch the recurring-franchise pattern (§5.10). Customer-dedup candidate: Rachel Green pair (customers 66684 / 66685).

**Build / platform**

- Email sending system: Amazon SES + Unlayer (replaces Omnisend); `aa_03_marketing` ready. Microsites V2 (consent + double opt-in). CSV ingestion tool for James's historic data.
- Freshdesk: "Ticket Updates" automation rule; Film → campaign mapping; historical XML backfill; migrate off Robin's personal API key.
- Handover items: Vercel project transfer to Robin; replace `payhere_secret` (Mart's personal key) with a service key.
- Claude Code app: confirm the 27 May prompt items shipped; dashboard RPC bucket-label fix (`shopify_legacy` currently routing into the shopify KPI bucket).

> _Note from Claude Code 18 Jun 2026: the bucket-label fix is shipped at commit `cb54388` — the new historic `source_platform='shopify'` (ISOT 2022) routes into the Shopify column. See NEXT.md._

---

End of handover — Creator VC OS, Supabase xwokhafcllstcnlcberv — last updated 18 June 2026 (rev 8).
