-- Step 3 of A2: one-time first-run after step 2 seeded the watermark.
-- Processes the (small) initial backlog so step 4's cron cutover sees
-- a steady-state incremental driver.
SELECT public.refresh_campaign_backers_snapshot_incremental() AS emails_processed;
