-- Repoint job 4 to the gated refresh. Quiet-period ticks become instant
-- no-ops; nothing goes more than 2h stale.
SELECT cron.schedule(
  'refresh-dashboard-snapshot',
  '*/30 * * * *',
  'SELECT public.refresh_dashboard_snapshot_gated();'
);
