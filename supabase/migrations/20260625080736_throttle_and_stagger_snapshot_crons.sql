-- Snapshot-refresh cron jobs were colliding and saturating the DB
-- (statement timeouts, broken pipes, disk-IO budget exhaustion).
-- Slow each one down and move them off shared minutes so no two
-- heavy jobs fire on the same tick.
SELECT cron.alter_job(4, schedule => '*/30 * * * *');  -- dashboard
SELECT cron.alter_job(5, schedule => '15 * * * *');     -- customer_list
SELECT cron.alter_job(6, schedule => '35 * * * *');     -- campaigns_list
SELECT cron.alter_job(7, schedule => '45 * * * *');     -- campaign_backers
