-- Step 4 of the A2 incremental campaign_backers_snapshot work.
-- (Step 3 was a one-time catch-up run, not preserved as a migration.)
-- Cut job 7 over from the slow full rebuild to the incremental driver,
-- every 5 minutes. Add a nightly full rebuild at 03:32 UTC as a
-- reconciliation safety net.

SELECT cron.alter_job(
  7,
  schedule => '*/5 * * * *',
  command  => 'SELECT public.refresh_campaign_backers_snapshot_incremental();'
);

SELECT cron.schedule(
  'reconcile-campaign-backers-snapshot-nightly',
  '32 3 * * *',
  'SELECT public.refresh_campaign_backers_snapshot();'
);
