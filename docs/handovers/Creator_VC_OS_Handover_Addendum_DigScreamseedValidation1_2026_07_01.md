# Creator VC OS — Handover Addendum

## Dig! (Campaign 16) + Screamseed Validation Leads — Batch 1

**Date:** 2026-07-01
**Author:** C Chat (Claude.ai / Supabase MCP)
**Connector:** Creator VC OS · db `postgres`
**Batch id:** `dig_screamseed_validation_1`
**Source file:** `Screamseed Validation` (working title Screamseed; campaign named **Dig!**)

---

### New campaign

| id | "Name" | legacy_code |
|----|--------|-------------|
| 16 | Dig!   | DIG_MOVIE   |

`legacy_code` is NOT NULL; `DIG_MOVIE` set per Mart (not the default `_DOC` documentary convention). No products/SKUs attached yet — leads only.

---

### Import summary

Source had 740 data rows in a survey-polluted `Email` column.

| Stage | Count |
|-------|-------|
| Raw data rows | 740 |
| Survey junk dropped (`n/a`×32, `yes`×8, `na`×2, `yes!`×1, `erik anderson`×1) | 44 |
| Malformed excluded (`nekromantik@09@gmail.com`, double `@`) | 1 |
| Obvious typo fixes applied | 2 |
| **Distinct clean emails** | **685** |
| — already in `contacts` (source-only add) | 605 |
| — brand-new contacts inserted | 80 |

**Typo fixes:** `wonderlandgrrl@gmail,com` → `wonderlandgrrl@gmail.com`; `livialacerda@gmal.com` → `livialacerda@gmail.com`.

**Kept by Mart's call** (screamseed-lookalike, not the known `im@idwithin.com` test address): `screamseed@mk2k.net`, `screenseed.f0ajo@passinbox.com`, `sloloem+screamseed@gmail.com`, `thebiggestseedbell@gmail.com`, `whistleknot+insearchofdarkness@gmail.com`.

---

### What was written

1. `aa_01_campaigns.campaigns` — inserted row id 16 (`Dig!` / `DIG_MOVIE`).
2. `aa_03_marketing.contacts` — 80 new rows, `email` only (so `marketing_consent` defaults **false**). Bare leads.
3. `aa_03_marketing.contact_sources` — 685 rows, `source_type='csv_import'`, `campaign_id=16`, all `source_*_id` NULL (satisfies `contact_sources_fk_matches_type`), `NOT EXISTS`-guarded (re-runnable). Metadata: `{"list":"Dig! (Screamseed Validation)","batch":"dig_screamseed_validation_1","imported_at":<ts>}`.

Migrations: `add_campaign_16_dig`, `import_dig_screamseed_validation_1`.

---

### Verification (post-write, vs locked dry-run)

| Check | Expected | Actual |
|-------|----------|--------|
| contacts total | 128,234 (128,154 + 80) | 128,234 ✓ |
| campaign-16 csv_import sources | 685 | 685 ✓ |
| batch-tagged sources | 685 | 685 ✓ |
| constraint violations (any source_*_id set) | 0 | 0 ✓ |
| campaign 16 Name / legacy | Dig! / DIG_MOVIE | ✓ |

---

### Outstanding

- **Snapshot refresh not run.** `public.refresh_campaigns_list_snapshot()` fails under the MCP role with `forbidden: revenue access denied` (raised in `get_campaign_stats_v3()`). Run manually in the **Supabase Dashboard SQL editor** (service role) so Dig! surfaces in the campaigns list UI:
  ```sql
  SELECT public.refresh_campaigns_list_snapshot();
  ```
  Customer/dashboard snapshots intentionally skipped — leads-only, no revenue change.
- **Consent:** all 685 land bare (`marketing_consent=false`). No SES send until consent activation for this batch.
