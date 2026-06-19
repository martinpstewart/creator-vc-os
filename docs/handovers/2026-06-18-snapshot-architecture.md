# Snapshot architecture: dashboard + customer list

_18 June 2026, written by Claude Code._

## TL;DR

`/dashboard` and `/customers` were timing out (Vercel error `2985362746@E394`, FUNCTION_INVOCATION_TIMEOUT, 10s limit on Hobby tier). Root cause: `home_dashboard_impl()` ran ~7s of joins on every page render; `get_customers_list()` had ballooned from 1.4s to ~7s after C Chat's `customer_summary` rewrite.

Switched both screens to pre-computed snapshot tables refreshed by `pg_cron`. Reads now ~1.5ms / ~80ms. Trade-off: dashboard data lags up to 5 min, customer list lags up to 10 min. Fine for both surfaces.

## What was built

### Tables (`aa_02_crm`)

```sql
CREATE TABLE aa_02_crm.dashboard_snapshot (
  id           int PRIMARY KEY DEFAULT 1,
  payload      jsonb NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_snapshot_singleton CHECK (id = 1)
);

CREATE TABLE aa_02_crm.customer_list_snapshot (
  id                     bigint PRIMARY KEY,
  email                  text NOT NULL,
  full_name              text,
  total_orders           int,
  total_spend            numeric,
  shipping_city          text,
  shipping_country       text,
  is_backer              boolean,
  campaign_orders_detail jsonb,
  raw_orders_detail      jsonb,
  isod_orders_detail     jsonb,
  historic_orders_detail jsonb,
  campaign_ids           int[],         -- GIN-indexed for campaign filter
  source_platforms       text[],        -- GIN-indexed for store filter
  search_text            text,          -- GIN trigram for ILIKE search
  refreshed_at           timestamptz NOT NULL DEFAULT now()
);
```

Both tables have `SELECT` granted to `anon, authenticated`.

### Functions

| Function | Role |
|---|---|
| `aa_02_crm.refresh_dashboard_snapshot()` | UPSERTs the single row by calling `home_dashboard_compute()` |
| `aa_02_crm.refresh_customer_list_snapshot()` | TRUNCATE + INSERT in a transaction. MVCC protects readers. |
| `public.refresh_dashboard_snapshot()` | Public wrapper (cron + admin) |
| `public.refresh_customer_list_snapshot()` | Public wrapper (cron + admin) |
| `public.home_dashboard_compute()` | **NEW**. The heavy aggregator — the body that used to be in `home_dashboard_impl`. Runs once per cron tick. |
| `public.home_dashboard_impl()` | Now a one-liner: `SELECT payload FROM aa_02_crm.dashboard_snapshot WHERE id=1` |
| `public.get_customers_list()` | Now a thin paginated SELECT against `customer_list_snapshot` with array-overlap + trigram filters |

### Cron schedules (`cron.job`)

| jobid | jobname | schedule | command |
|---|---|---|---|
| 4 | `refresh-dashboard-snapshot` | `*/5 * * * *` | `SELECT public.refresh_dashboard_snapshot()` |
| 5 | `refresh-customer-list-snapshot` | `*/10 * * * *` | `SELECT public.refresh_customer_list_snapshot()` |

## Performance

| Surface | Before | After |
|---|---|---|
| `home_dashboard_impl()` | ~7s | **1.5ms** |
| `get_customers_list(null,1,50,…)` | ~7s | **~30ms** |
| `get_customers_list('robin',…)` (search) | ~7s | **~78ms** |
| `get_customers_list(…, ARRAY[6], …)` (campaign filter) | ~7s | **~30ms** |
| Refresh procs (run once per cron tick) | — | ~7s dashboard / ~15s customers |

## Frontend changes

- `lib/supabase.ts`: removed the `unstable_cache` wrappers around `getHomeDashboardCached` and `getCustomers`. The DB is the cache now; layering Next.js cache on top would just delay updates from cron. `getCustomerByEmail` kept its cache for now (its underlying RPC isn't snapshotted).
- `app/(app)/page.tsx` and the heavy customer/campaign routes still carry `export const maxDuration = 60`. With snapshot reads completing in milliseconds this is now a belt-and-braces measure, but it doesn't hurt.

## Migration files

- `supabase/migrations/20260618120000_snapshot_tables_and_refresh_jobs.sql` — captures the full state. Idempotent; safe to re-run.

## Decisions made / why

1. **TRUNCATE + INSERT inside a single transaction** for the customer list refresh. Postgres MVCC means concurrent readers see the old data until commit; no "empty list" race. Alternative (build to staging table, swap with RENAME) is cleaner long-term but more fiddly. Revisit if the refresh starts blocking readers measurably.
2. **The `paying` gate** (`v_paying_customer_emails`) is INSIDE the refresh proc, so the snapshot is paying-only. The RPC's `p_include_unpaid` flag is now a no-op — left in the signature so callers don't break. If a UI flag for unpaid ever appears we'll add a second snapshot column or a parallel table.
3. **`home_dashboard_compute()` is a separate function** rather than inlining the body into the refresh proc. Makes the heavy logic easier to test in isolation (`SELECT home_dashboard_compute();`) and easier to call manually if cron is paused.
4. **Anon EXECUTE on `home_dashboard_impl()`** because the Next.js cached fetcher uses the stateless anon-key client. Middleware enforces admin-only on `/` at the route level, so the un-gated impl being callable doesn't widen the security envelope.

## What this means for the other Claude

- **Anything that mutates the data the dashboard or customer list reads** (new historic order batch, new contact, new campaign) will not appear on `/` or `/customers` until the next cron tick.
- **To make new imports visible immediately**, call:
  ```sql
  SELECT public.refresh_dashboard_snapshot();
  SELECT public.refresh_customer_list_snapshot();
  ```
- **When adding a new `source_platform` value**, edit `home_dashboard_compute()`. Bucket routing currently knows: `shopify`, `shopify_legacy`, `gumroad`, `wix`, `indiegogo`, `kickstarter`, `crowdox` (latter rolls into Other Sources via NOT IN).
- **Do not disable cron jobs 4 + 5.** Stopping them freezes the screens at the last refreshed value.
- **Do not TRUNCATE the snapshot tables manually.** The refresh procs do it inside a transaction; manual TRUNCATE outside a transaction would briefly show readers an empty list.

## What's still slow / next steps

- Customer detail (`/customers/[email]`) still hits `get_customer_detail` at ~1.1s. Could snapshot per-email or split the call further. Currently a `unstable_cache` band-aid in `lib/supabase.ts` keeps it under control.
- Dashboard renders ~80kB of HTML at once. Splitting Suspense boundaries per channel column would make first paint faster than the snapshot read time (1.5ms is already faster than human perception, but the React render isn't).
