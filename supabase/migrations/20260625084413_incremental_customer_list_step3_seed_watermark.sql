-- Step 3 of the A1 incremental customer_list_snapshot work.
-- Seed the watermark to when the snapshot was last fully rebuilt. The
-- first incremental run will then process exactly the customers
-- changed since that baseline. The existing snapshot (from the
-- throttled full-rebuild cron) is the baseline; nothing is rebuilt
-- here.
INSERT INTO aa_02_crm.snapshot_watermarks(name, watermark)
SELECT 'customer_list', coalesce(max(refreshed_at), '-infinity')
FROM aa_02_crm.customer_list_snapshot
ON CONFLICT (name) DO UPDATE SET watermark = excluded.watermark;
