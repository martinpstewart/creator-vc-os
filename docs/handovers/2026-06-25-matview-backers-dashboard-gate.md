# Claude Code — wire-up brief (2026-06-25, round 2: matview + backers + dashboard gate)

Follows on from `2026-06-25-snapshot-perf-and-freshdesk.md`. Everything below is
**already applied to production** (`xwokhafcllstcnlcberv`, eu-west-2). No DB writes needed from
you — the database is done. Your job is repo parity, repointing the app calls that benefit, and
committing this brief.

---

## What changed in production this session

1. **`campaign_backers_snapshot` → incremental (A2).** The 138k-row backers snapshot was doing a
   full TRUNCATE + rebuild hourly — the last big disk-IO consumer. Now refreshed incrementally
   (delete-then-recompute per changed email, driven by the same `customers.updated_at` watermark
   pattern as A1) every 5 min, with a nightly full rebuild (job 9) as reconciliation. Row parity
   verified exact.

2. **Attribution view materialised (the matview round).** `aa_01_campaigns.v_raw_order_line_attribution`
   is a view that unnests `raw_orders.payload->'line_items'` and runs 3 correlated variant-resolution
   subplans per line — ~6.8s per scan. It's now backed by a materialised view,
   `aa_01_campaigns.mv_raw_order_line_attribution` (~24k rows, one per order line), refreshed
   `CONCURRENTLY` every 15 min. Two snapshot functions were repointed to it (see below). **The live
   view still exists and is unchanged** — nothing was swapped in place, so any consumer not listed
   below still reads live data.

3. **Dashboard refresh change-gated.** `build_home_dashboard_payload()` rebuild is ~32s. Job 4 now
   calls `public.refresh_dashboard_snapshot_gated()`, which skips the rebuild unless order activity
   occurred since the last build (via `max(customers.updated_at)`), the snapshot is >2h old, or the
   date rolled over. Quiet-period ticks become instant no-ops; nothing goes >2h stale.

### Honest note on the matview's impact
The matview was expected to fix the dashboard. It didn't, much — the dashboard is still ~32s after
repointing, because its cost was never mostly attribution: it also re-aggregates `historic_orders`/
`historic_order_lines` (105k rows) 6–8 times per build and recomputes `v_paying_customer_emails`
(~4.8s) every time. The **change-gate** is the real dashboard win, not the matview. Where the matview
*did* pay off: `get_campaign_stats_v3` (campaigns-list, hourly) went ~30s → instant, and the six
app-facing attribution functions below can now be repointed for big per-request speedups.

---

## Tasks for you

### 1. Bring DB migrations into the repo
Already in prod (`supabase_migrations.schema_migrations`). Pull into `supabase/migrations/`:
- `incremental_campaign_backers_step1_functions`
- `incremental_campaign_backers_step2_seed_watermark`
- `incremental_campaign_backers_step3_first_run`
- `incremental_campaign_backers_step4_cron_cutover`
- `attribution_matview_step1_create`
- `attribution_matview_step2_refresh_cron`
- `attribution_matview_step3a_repoint_campaign_stats`
- `attribution_matview_step3b_repoint_dashboard`
- `dashboard_change_gate_step1_function`
- `dashboard_change_gate_step2_cron_cutover`

`db pull` won't reliably capture `cron.*` state or function grants — the explicit cron table is in
the Appendix.

### 2. Repoint app-facing attribution reads to the matview (the per-request win)
These six functions still read the live view and recompute the ~6.8s unnest on **every app request**.
Repointing them to `aa_01_campaigns.mv_raw_order_line_attribution` makes them near-instant. They are
read-shape-identical against the matview (same columns), so this is a pure relation-name swap:

- `public.get_campaign_backer_list_v2`
- `public.get_campaign_products_v2`
- `public.get_campaign_stats_v2`
- `public.get_campaign_units_sold`
- `public.get_campaign_units_sold_v2`
- the view `aa_01_campaigns.v_all_orders`

**Staleness caveat — this is the decision to make per function.** The matview is up to ~15 min stale
(refresh cadence). For campaign analytics pages (backer counts, units sold, product rollups) that's
fine. If any of these is read on a path that must reflect an order *within seconds* of it landing,
leave that one on the live view. Pick per-function; you can see the app call sites, I can't.

The safe swap mechanism (no transcription risk) is the one used for the dashboard — transform the
function's own definition in-DB:

```sql
DO $do$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.get_campaign_products_v2()'::regprocedure) INTO v_def;
  v_def := replace(v_def,
    'aa_01_campaigns.v_raw_order_line_attribution',
    'aa_01_campaigns.mv_raw_order_line_attribution');
  EXECUTE v_def;
END $do$;
```

(Confirm each signature with `regprocedure` first — `get_campaign_backer_list_v2` takes args.)
`v_all_orders` is a view, not a function — recreate it via `CREATE OR REPLACE VIEW` with the same swap.

### 3. Repoint app calls to the full backers rebuild
Grep for `refresh_campaign_backers_snapshot` (the full, slow RPC). On any user path, switch to:

```
public.refresh_campaign_backers_snapshot_incremental()   -- returns int = emails processed
```

Keep the full `public.refresh_campaign_backers_snapshot()` only for an explicit admin "force full
rebuild"; it's otherwise the nightly reconcile (job 9).

### 4. `refreshed_at` semantics on `campaign_backers_snapshot` (app contract)
Same change as A1's customer list: `refreshed_at` is now **per-row** (when that backer row last
changed), not one shared full-rebuild timestamp. For a "last updated" indicator use
`max(refreshed_at)` or the watermark:
`SELECT watermark FROM aa_02_crm.snapshot_watermarks WHERE name='campaign_backers'`.
Schema and row contents are otherwise identical (verified) — reads/filters/sort/pagination unchanged.

### 5. "Last updated" for the dashboard
With the gate, the dashboard only rebuilds when warranted, so `dashboard_snapshot.refreshed_at` is
"last time it was actually rebuilt", which may legitimately be up to 2h ago in quiet periods. If the
UI shows a freshness stamp, that's correct behaviour, not staleness — but if it currently implies
"updated every 30 min", reword it.

### 6. Commit the handover
Drop this into `docs/handovers/2026-06-25-matview-backers-dashboard-gate.md` and update `NEXT.md`.

---

## NEXT.md additions

- **Dashboard still ~32s when it does rebuild.** The gate avoids most rebuilds, but each real one is
  still heavy. If the profile needs flattening further, the lever is the historic re-aggregation:
  `build_home_dashboard_payload` scans `historic_orders`/`historic_order_lines` 6–8× per build, plus
  `v_paying_customer_emails` (~4.8s `UNION DISTINCT`). Candidate: scan historic once into a temp
  table per build, derive the shopify/gumroad/other rollups from it. Optional — it's polish now, not
  firefighting.
- **`mv_raw_order_line_attribution` refresh cost.** Full `CONCURRENTLY` recompute (~7–8s) every
  15 min. If `raw_orders` write volume grows, consider gating the refresh on a `raw_orders` change
  signal rather than unconditional cadence.
- **Compute add-on review.** Still on **Nano** (43 Mbps baseline IO). With A1/A2 + matview + gate the
  heavy rebuilds are gone and IO pressure is well off the ceiling — re-evaluate whether an upsize is
  even needed before spending on it.

---

## Appendix — final cron state (all jobs)

| jobid | jobname | schedule | command |
|---|---|---|---|
| 1 | freshdesk-hourly-poll | `0 * * * *` | `net.http_post(... /freshdesk-poll)` |
| 3 | payhere-hourly-poll | `0 * * * *` | `net.http_post(... /payhere-poll)` |
| 4 | refresh-dashboard-snapshot | `*/30 * * * *` | `SELECT public.refresh_dashboard_snapshot_gated()` |
| 5 | refresh-customer-list-snapshot | `*/2 * * * *` | `SELECT public.refresh_customer_list_snapshot_incremental()` |
| 6 | refresh-campaigns-list-snapshot | `35 * * * *` | `SELECT public.refresh_campaigns_list_snapshot()` |
| 7 | refresh-campaign-backers-snapshot | `*/5 * * * *` | `SELECT public.refresh_campaign_backers_snapshot_incremental()` |
| 8 | reconcile-customer-list-snapshot-nightly | `17 3 * * *` | `SELECT public.refresh_customer_list_snapshot()` |
| 9 | reconcile-campaign-backers-snapshot-nightly | `32 3 * * *` | `SELECT public.refresh_campaign_backers_snapshot()` |
| 10 | refresh-attribution-matview | `7,22,37,52 * * * *` | `SELECT public.refresh_attribution_matview()` |

## Appendix — new DB objects this round

**A2 (campaign backers incremental)**
- `aa_02_crm.refresh_campaign_backers_for_emails(text[])` — scoped per-(campaign,email) builder,
  delete-then-recompute. Reuses A1's `*_email_btrim*` indexes.
- `aa_02_crm.refresh_campaign_backers_snapshot_incremental()` — watermark-driven driver
  (`snapshot_watermarks.name='campaign_backers'`).
- `public.refresh_campaign_backers_snapshot_incremental()` → int — granted `anon, authenticated`.

**Matview round**
- `aa_01_campaigns.mv_raw_order_line_attribution` — matview, `SELECT *` from the live view (identical
  columns). Unique index `mv_raw_order_line_attribution_pk (raw_order_id, line_index)` (required for
  `CONCURRENTLY`); partial `mv_rola_paid_campaign_idx (product_campaign_id) WHERE financial_status='paid'`.
- `public.refresh_attribution_matview()` → void — `REFRESH MATERIALIZED VIEW CONCURRENTLY`, granted
  `anon, authenticated`, cron job 10 every 15 min.
- Repointed to the matview: `public.build_home_dashboard_payload`, `public.get_campaign_stats_v3`.
  (Parity verified to the penny against the prior view-based output.)

**Dashboard gate**
- `public.refresh_dashboard_snapshot_gated()` → boolean (true=rebuilt, false=skipped). Granted
  `anon, authenticated`. Uses `snapshot_watermarks.name='dashboard'` + `dashboard_snapshot.refreshed_at`.
  Skip = no activity since watermark AND snapshot <2h old AND same day; else rebuild via the existing
  `public.refresh_dashboard_snapshot()` and advance the watermark.
