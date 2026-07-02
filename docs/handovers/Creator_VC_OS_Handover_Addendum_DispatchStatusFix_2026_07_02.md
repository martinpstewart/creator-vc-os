# Creator VC OS — Handover Addendum: Delivery Status Fix (Historic/Non-Live Orders)

**Date:** 2026-07-02
**Author:** C Chat (Claude.ai DB/data-ops instance)
**Scope:** `public.get_customer_campaign_orders` + `aa_01_campaigns.campaigns`
**Trigger:** ISOD 70s (campaign 7) orders reporting `dispatched` despite the campaign never having been through the shipping payment phase.

---

## Problem

Orders for **In Search of Darkness 70s** (`ISOD_70S`, campaign id 7) were showing a delivery status of `dispatched`. This is impossible — the campaign has not yet entered its shipping payment phase, so nothing has been dispatched.

## Root cause

`public.get_customer_campaign_orders(p_email, p_campaign_id)` builds its `delivery_status` column across four `UNION ALL` branches:

| Branch | Source | Old `delivery_status` logic |
|---|---|---|
| 1 | `raw_orders` (live webhook) | Looks up `aa_01_campaigns.acutrack_received` by `ponumber = shopify_order_number`. `shipped → dispatched`, `new → shipping_paid`, no match → `pending_shipping`. **Correct.** |
| 2 | `v_crm_customer_purchases` | Hardcoded literal `'dispatched'` |
| 3 | `isod_orders` | Hardcoded literal `'dispatched'` |
| 4 | `historic_orders` | Hardcoded literal `'dispatched'` |

Only branch 1 consulted reality. Branches 2–4 assumed all non-live orders were already fulfilled.

For campaign 7 specifically:
- **2,408** paid `raw_orders` — already resolving correctly to `pending_shipping` (zero acutrack matches).
- **4,304** `historic_order_lines` (all `order_status='paid'`) — hitting branch 4 and being stamped `dispatched`.

Note branch 4 (historic) has **no** "campaign has no raw_orders" guard, unlike branches 2 and 3. So even though campaign 7 has live raw_orders, its historic lines still fired through the hardcoded branch.

### Why not just make historic consult acutrack?

`acutrack_received` covers only the live/webhook population. Of **118,906** paid historic orders, **0** match acutrack by `source_order_id`. Routing historic through acutrack would wrongly flip every genuinely-shipped legacy campaign to `pending_shipping`. Rejected.

## Fix

A per-campaign fulfilment flag, defaulting to preserve existing behaviour everywhere.

1. **Schema** — added:
   ```sql
   ALTER TABLE aa_01_campaigns.campaigns
     ADD COLUMN historic_dispatched boolean NOT NULL DEFAULT true;
   ```
   Semantics: when `false`, this campaign's non-live (historic / isod / crm) order lines report `pending_shipping` instead of the assumed `dispatched`. Live `raw_orders` always use `acutrack_received` and ignore this flag.

2. **Function** — branches 2, 3, 4 changed from the literal `'dispatched'` to:
   ```sql
   case when (select c.historic_dispatched from aa_01_campaigns.campaigns c where c.id = p_campaign_id)
        then 'dispatched' else 'pending_shipping' end
   ```
   Branch 1 (raw_orders / acutrack) unchanged. `GRANT EXECUTE ... TO anon, authenticated` re-applied in the same migration.

3. **Data** — flagged ISOD 70s:
   ```sql
   UPDATE aa_01_campaigns.campaigns SET historic_dispatched = false WHERE id = 7;
   ```

Because the column defaults `true`, all 15 other campaigns are unchanged.

## Verification (post-migration, against locked dry-run)

| Check | Expected | Actual |
|---|---|---|
| Camp 7 flag | `false` | `false` |
| Campaigns flagged false / true | 1 / 15 | 1 / 15 |
| Camp 7 historic lines flipped to `pending_shipping` | 4,304 | 4,304 |
| Live function call — camp 7 historic customer | `pending_shipping` | `pending_shipping` |
| Live function call — control campaign (flag true) historic customer | `dispatched` | `dispatched` (no regression) |

## Operating the flag (scalability)

- **New campaign, pre-shipping:** set `historic_dispatched = false` at creation.
  ```sql
  UPDATE aa_01_campaigns.campaigns SET historic_dispatched = false WHERE id = <new_campaign_id>;
  ```
- **Shipping phase begins:** flip to `true`.
  ```sql
  UPDATE aa_01_campaigns.campaigns SET historic_dispatched = true WHERE id = <campaign_id>;
  ```
- Default (`true`) means any campaign left unset behaves as fully-dispatched, matching legacy behaviour.
- Live `raw_orders` are independent of the flag — they always derive dispatch from `acutrack_received`.

## Action for Claude Code (frontend / PWA)

`pending_shipping` can now appear on **historic** order lines, not just live orders. Confirm the CRM / customer order display has a badge/label for `pending_shipping`; add one if the UI currently only styles `dispatched` / `shipping_paid`. The full `delivery_status` domain returned by `get_customer_campaign_orders` is: `dispatched`, `shipping_paid`, `pending_shipping`.

## Status

Applied and verified in production (`postgres`, project `xwokhafcllstcnlcberv`). No follow-up DB work outstanding for this item.
