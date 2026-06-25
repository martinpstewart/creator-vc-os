-- Step 2 of the A2 incremental campaign_backers_snapshot work.
-- Seed the watermark to when the snapshot was last fully rebuilt. The
-- first incremental run will then process exactly the customers
-- changed since that baseline. The existing snapshot (from the prior
-- full-rebuild cron) is the baseline; nothing is rebuilt here.
INSERT INTO aa_02_crm.snapshot_watermarks(name, watermark)
SELECT 'campaign_backers', coalesce(max(refreshed_at), '-infinity')
FROM aa_02_crm.campaign_backers_snapshot
ON CONFLICT (name) DO UPDATE SET watermark = excluded.watermark;
