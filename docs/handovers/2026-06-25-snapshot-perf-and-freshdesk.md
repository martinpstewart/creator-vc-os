# Claude Code — wire-up brief (2026-06-25)

This session was DB/data-ops work in the C Chat (Supabase) project. Everything below is
**already applied to production** (`xwokhafcllstcnlcberv`, eu-west-2). Your job is to bring the
repo into sync, repoint any app calls that need it, and commit the handover doc. No DB writes
needed from you — the database is done.

---

## What changed in production this session

1. **Cron throttle + stagger.** The snapshot-refresh cron jobs were colliding and saturating the
   DB (statement timeouts, broken pipes, disk-IO budget exhaustion). They've been slowed and
   staggered so no two heavy jobs share a minute.

2. **`freshdesk-webhook` → v15 (ack-first).** Was timing out (504s to Freshdesk) because it did two
   synchronous DB round-trips before responding. Now returns `200` immediately and does the capture
   + `freshdesk_ingest` in `EdgeRuntime.waitUntil()`. **Deployed via Dashboard paste**, so the repo
   copy is stale — see task 1.

3. **`customer_list_snapshot` → incremental (A1).** The 76k-row list was doing a full TRUNCATE +
   rebuild from the `customer_summary` view every cycle (68–109s, ~450 MB WAL). It's now refreshed
   incrementally — only customers changed since a watermark — every 2 min, with a nightly full
   rebuild as reconciliation.

`campaign_backers_snapshot` (138k rows) is **still on the old full-rebuild path** — that's the next
phase (A2), do not touch it.

---

## Tasks for you

### 1. Sync the `freshdesk-webhook` function source (important)
The deployed v15 was pasted into the Dashboard and is NOT in the repo. Overwrite
`supabase/functions/freshdesk-webhook/index.ts` with the v15 source (file:
`freshdesk-webhook-index.ts`, provided alongside this brief). `deno.json` is unchanged
(`{ "imports": {} }`). Do **not** redeploy via CLI without confirming — a stale repo deploy would
revert v15. The goal here is repo parity, not redeployment.

### 2. Bring DB migrations into the repo
These migrations are already in prod (in `supabase_migrations.schema_migrations`). Pull them into
`supabase/migrations/` for parity (`supabase db pull`, or transcribe from the migration history):
- `throttle_and_stagger_snapshot_crons`
- `incremental_customer_list_step1_infrastructure`
- `incremental_customer_list_step2_functions`
- `incremental_customer_list_step3_seed_watermark`
- `incremental_customer_list_step5_cron_cutover`

`db pull` won't capture the `cron.*` config or function grants reliably — the explicit cron state is
in the Appendix below; add it as a migration if you version cron jobs.

### 3. Repoint any app calls to the full customer-list rebuild
Grep the app for `refresh_customer_list_snapshot` (the full, slow RPC). Anywhere the app calls it on
a user path — a "Refresh list" button, a post-action refresh — switch to the new cheap RPC:

```
public.refresh_customer_list_snapshot_incremental()   -- returns int = rows processed
```

Keep the full `public.refresh_customer_list_snapshot()` only for an explicit "force full rebuild"
admin action, if one exists. It is otherwise driven by the nightly reconcile cron.

### 4. Mind the `refreshed_at` semantics change (app contract)
Previously every row in `customer_list_snapshot` shared one `refreshed_at` (the full-rebuild time).
Now `refreshed_at` is **per-row** — the last time *that customer* changed. So:
- A single "list last updated at X" indicator should use `max(refreshed_at)` **or**, better, the
  incremental watermark: `SELECT watermark FROM aa_02_crm.snapshot_watermarks WHERE name='customer_list'`.
- Any code assuming all rows share one timestamp needs adjusting.

The list's **schema and row contents are otherwise identical** (verified column-by-column), so
read queries, filters, search, sorting, pagination all work unchanged.

### 5. Commit the handover
Drop this brief into `docs/handovers/2026-06-25-snapshot-perf-and-freshdesk.md` and update `NEXT.md`
with the open items below.

---

## NEXT.md additions

- **A2 — `campaign_backers_snapshot` incremental.** Same pattern as A1: scoped per-(campaign,email)
  builder driven by changed customers, incremental cron + nightly reconcile. 138k rows still doing a
  full TRUNCATE+rebuild hourly — the remaining big disk-IO consumer.
- **Dashboard / campaigns-list snapshot compute.** `build_home_dashboard_payload()` and
  `get_campaign_stats_v3()` are slow (heavy compute, cheap write). Throttle holds them apart but
  they're not cheap — candidates for incremental/materialised aggregates if the IO/CPU profile needs
  flattening further.
- **Compute add-on review.** Project is on Pro but still **Nano** compute (43 Mbps baseline IO).
  Re-evaluate after A2 — the goal is to get off the IO ceiling by cutting work, not by upsizing.

---

## Appendix — final cron state (jobs)

| jobid | jobname | schedule | command |
|---|---|---|---|
| 4 | refresh-dashboard-snapshot | `*/30 * * * *` | `SELECT public.refresh_dashboard_snapshot()` |
| 5 | refresh-customer-list-snapshot | `*/2 * * * *` | `SELECT public.refresh_customer_list_snapshot_incremental()` |
| 6 | refresh-campaigns-list-snapshot | `35 * * * *` | `SELECT public.refresh_campaigns_list_snapshot()` |
| 7 | refresh-campaign-backers-snapshot | `45 * * * *` | `SELECT public.refresh_campaign_backers_snapshot()` |
| 8 | reconcile-customer-list-snapshot-nightly | `17 3 * * *` | `SELECT public.refresh_customer_list_snapshot()` |

## Appendix — new DB objects (A1)

- `aa_02_crm.snapshot_watermarks(name text pk, watermark timestamptz)` — incremental cursor.
- Indexes: `aa_02_crm.idx_crm_customers_updated_at`;
  `aa_01_campaigns.idx_raw_orders_email_btrim_paid` (partial, `financial_status='paid'`);
  `aa_01_campaigns.idx_historic_orders_email_btrim_paid` (partial, `order_status='paid'`);
  `aa_01_campaigns.idx_isod_orders_email_btrim`.
- `aa_02_crm.refresh_customer_list_snapshot_changed(p_ids bigint[])` — scoped row-builder
  (identical row shape to the full rebuild; index-backed per-email paying check).
- `aa_02_crm.refresh_customer_list_snapshot_incremental()` → int — watermark-driven driver.
- `public.refresh_customer_list_snapshot_incremental()` → int — granted to `anon, authenticated`.

The incremental path can't see a customer going non-paying without an `updated_at` bump; the nightly
full rebuild (job 8) reconciles that drift. Dirty detection relies on `customers.updated_at`, which
the shopify-webhook (Step 4, `refresh_customer_aggregates`) and the import protocol already stamp —
no webhook change was needed.
