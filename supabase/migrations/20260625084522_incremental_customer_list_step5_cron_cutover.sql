-- Step 5 of the A1 incremental customer_list_snapshot work.
-- Cut job 5 over from the slow full rebuild to the incremental
-- driver, every 2 minutes. Add a nightly full rebuild at 03:17 UTC as
-- a reconciliation safety net — heals any boundary-tie or
-- non-paying-flip drift the incremental path can miss.

-- Repoint job 5: full rebuild → incremental driver, every 2 minutes.
SELECT cron.alter_job(
  5,
  schedule => '*/2 * * * *',
  command  => 'SELECT public.refresh_customer_list_snapshot_incremental();'
);

-- Nightly full rebuild as reconciliation safety net (heals any boundary-tie
-- or non-paying-flip drift the incremental path can miss). 03:17 UTC, off-peak.
SELECT cron.schedule(
  'reconcile-customer-list-snapshot-nightly',
  '17 3 * * *',
  'SELECT public.refresh_customer_list_snapshot();'
);
