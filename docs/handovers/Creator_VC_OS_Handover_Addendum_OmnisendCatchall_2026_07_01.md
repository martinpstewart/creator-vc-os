# Creator VC OS — Handover Addendum: Omnisend Catchall Import + Marketing List Views
**Date:** 2026-07-01
**Session owner:** C Chat (DB/data-ops via Creator VC OS MCP)
**Batch id:** `omnisend_catchall_2026_07_01`

---

## Summary
Final "kitchen-sink" contacts import from James — a generic newsletter/socials/interest
list with **no campaign attribution**. Loaded as bare leads (`marketing_consent=false`),
tagged with an additive `csv_import` source row on every matched contact. Also introduced
a view-based **General list** layer for C Code to build a list selector on the marketing screen.

## Baseline → Final (verified)
| Table | Before | After | Δ |
|---|---|---|---|
| `aa_03_marketing.contacts` | 128,243 | **152,800** | +24,557 |
| `aa_03_marketing.contact_sources` | 215,864 | **359,591** | +143,727 |
| `aa_02_crm.customers` | 79,693 | 79,693 | 0 (untouched) |

## Source file & cleaning
- Raw rows: 143,860 (single `Email` column, already internally unique — 0 dupes).
- Exclusions: 1 test (`im@idwithin.com`), 15 `@creatorvc.com` staff, 16 invalid-format.
- Typo fixes: `.com.com`→`.com`, `.con`→`.com`, provider `.co`→`.com`; 30 ambiguous `.co` left as-is.
- Post-fix dedup merged 101 collisions.
- **Final clean set: 143,727** (= staging gate total = distinct).

## Promotion (batch `omnisend_catchall_2026_07_01`)
1. `omnisend_catchall_insert_new_contacts` — inserted **24,557** new contacts, `marketing_consent=false`, `customer_id` NULL, no consent source, no SES.
2. `omnisend_catchall_insert_source_rows` — inserted **143,727** additive rows:
   `source_type='csv_import'`, `campaign_id=NULL`,
   `metadata={"list":"Omnisend Catchall","batch":"omnisend_catchall_2026_07_01","imported_at":<epoch>}`,
   guarded by `NOT EXISTS` on the batch. Existing contacts' consent untouched (sticky-upwards preserved).
3. Staging `public._omnisend_catchall_staging` dropped.

New-vs-existing split at gate: 24,557 new / 119,170 already-existing (heavy overlap as expected for a kitchen-sink export).

## New: Marketing list views (view-based, no new base tables)
Created in `aa_03_marketing`, `GRANT SELECT` to `anon, authenticated`:

- **`v_contact_list_membership(contact_id, email, list_name, marketing_consent, unsubscribed_at)`**
  - Emits a `General Newsletter` row for **every** contact (per Mart's call: General = all contacts).
  - Plus one row per `(contact, distinct metadata->>'list')` from `contact_sources`.
- **`v_marketing_lists(list_name, member_count, consented_count)`** — dropdown source.

**C Code selector usage:** read `v_marketing_lists` for the dropdown; filter contacts with
`SELECT contact_id FROM aa_03_marketing.v_contact_list_membership WHERE list_name = $1`.
Consent/unsub flags are exposed on the membership view so the UI can gate sends later.

Current list snapshot (top by member_count): General Newsletter 152,800 (39,099 consented),
Omnisend Catchall 143,727 (37,444), ISOD 90-94 Leads 1 15,337, `omnisend` 13,017, TTE Leads 1 10,490, …

## Snapshots
No refresh required — no campaign attribution, no orders/revenue, `customers` untouched.
`dashboard_snapshot`/`customer_list_snapshot` gated on `customers.updated_at`, unaffected.

## Consent / SES status
- All new contacts `marketing_consent=false`. **No emails from app or SES at present.**
- Consent activation deferred: James expected to provide a CSV of confirmed-subscribed
  contacts in future to update consent before any send. No bare-lead batch is send-eligible until then.

## Flags / follow-ups
- **Label hygiene:** a legacy list label `omnisend` (lowercase, 13,017 members — Shelby Oaks Omnisend origin)
  sits alongside properly-cased list names. Consider normalising the `metadata->>'list'` label if it
  should appear tidily in the selector.
- If lists ever need to be UI-editable/curated (not just derived), revisit as a real
  `contact_lists` + junction table; current view layer is read-only/derived by design.

## Commit note
GitHub MCP write returns 403 from this instance — commit this addendum to
`docs/handovers/` and update `NEXT.md` manually or via Claude Code.
