# Handover Addendum — Omnisend Kickstarter Contact Imports (ISOTLAH + ISOD 80s Part 1)

**Date:** 2026-07-01
**Instance:** C Chat (DB/data-ops, Creator VC OS MCP)
**Type:** Contacts-only (leads), additive. No customers, orders, or revenue touched.

## Summary
Two historical Omnisend Kickstarter contact exports ingested to their campaigns via standard staging protocol.

| Batch | List | Campaign | Distinct emails |
|---|---|---|---|
| `isotlah_kickstarter_omnisend_1` | ISOTLAH Kickstarter Omnisend | **6 — In Search of the Last Action Heroes** | 690 |
| `isod80sp1_kickstarter_omnisend_1` | ISOD 80s Part 1 Kickstarter Omnisend | **8 — In Search of Darkness 80's** | 1,328 |

## Registry correction
**Campaign 6 = "In Search of the Last Action Heroes" (ISOTLAH).** Prior registry notes mis-associated ISOTLAH with the "In Search of Tomorrow" (ISOT) line. LAH = Last Action Heroes. Confirmed against live `aa_01_campaigns.campaigns`.

## Data-quality note — ISOTLAH corrupted header
The ISOTLAH source (`ISOTLAH_Kickstarter_Omnisend__Sheet1.csv`) had a corrupted header row: the standard 12-column Omnisend layout was intact, but a block of 11 contacts' names/emails had been mashed into the header labels (export artifact). Body (679 distinct) was clean from row 2. The 11 trapped contacts were recovered (all net-new, none present in body) with names reconstructed by token-alignment, per Mart's approval (option b):

| Email | Name | Confidence |
|---|---|---|
| a.woywitka@hotmail.com | Amber Woywitka | high |
| gdpwatson@gmail.com | Gareth Watson | high |
| paulebrammer@gmail.com | Paul Brammer | high |
| annm.hayden@sbcglobal.net | Annie Hayden | high |
| gorecki.ondrej@seznam.cz | Ondrej Gorecki | high |
| aceartemis7@gmail.com | AceArtemis7 (handle) | handle-only |
| zacharyrmoore@gmail.com | Zachary Moore | inferred |
| darth_oblivion@yahoo.com | Alvin Jefferson | low |
| motimokot@gmail.com | (blank) | n/a |
| kickstart@superbacker.net | (blank — superbacker label) | n/a |
| team@thecreative.fund | (blank — Creative Fund/BackerKit) | n/a |

679 body + 11 recovered = 690 ISOTLAH distinct.

## Dupe analysis (pre-promotion, locked)
- **Duplicate contacts:** none created. Emails matched via `citext` `NOT EXISTS`; only net-new inserted.
- **Duplicate attributions:** none. `already_have_csvimport` = 0 for both campaigns — no contact previously carried a `csv_import` source for 6 or 8, so every staged row was a first-time `csv_import` attribution.
- Existing contacts already attributed to the campaign via **other** source types (353 on c6, 613 on c8) were left untouched; the new `csv_import` row is additive provenance (marketing-list membership distinct from order/other source).

## Net writes (verified against locked dry-run)
| Table | Before | After | Δ |
|---|---|---|---|
| `aa_03_marketing.contacts` | 128,234 | 128,243 | +9 (2 on c6, 7 on c8; no cross-file overlap) |
| `aa_03_marketing.contact_sources` | 213,846 | 215,864 | +2,018 (690 c6 + 1,328 c8) |

- New `contact_sources`: `source_type='csv_import'`, `campaign_id` 6/8, all `source_*_id` NULL, metadata `{"list":…,"batch":…,"imported_at":now()}`. Guard `NOT EXISTS (contact_id, campaign_id, 'csv_import', batch)` → idempotent.
- New contacts: `marketing_consent=false`. Existing contacts unchanged (no name/consent overwrite, no `last_seen_at` bump).

## Consent / SES
Neither file carried a subscriber-status column → **no consent signal**. All new contacts `marketing_consent=false`. **No SES send** to these batches until lead consent activation.

## Open items
- **`refresh_campaigns_list_snapshot()` not run from MCP.** It internally calls `get_campaign_stats_v3()`, which raises `forbidden: revenue access denied` under the MCP role. Snapshot holds orders/customers/revenue only — unchanged by a contacts-only import — so contents are identical regardless. Left to pg_cron (jobs 4/5); can be forced in Dashboard SQL editor under the privileged role if desired. **New known artifact:** campaign snapshot refresh RPCs are not MCP-invokable due to the revenue-access guard.
- Staging tables `public._isotlah_ks_omnisend_staging` / `public._isod80sp1_ks_omnisend_staging` created and dropped this session.
