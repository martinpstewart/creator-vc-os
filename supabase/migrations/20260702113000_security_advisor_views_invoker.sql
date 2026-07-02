-- Flip `security_invoker` on the 4 views the advisor flagged. Default
-- is false, which is what makes them run as the view owner (postgres)
-- regardless of the caller — the "SECURITY DEFINER view" pattern.
--
-- All current callers are either:
--   * SECURITY DEFINER RPCs (get_dispatch_alerts, marketing_*,
--     build_home_dashboard_payload, etc.) — inside those, current_user
--     IS the owner, so the view behaves identically whether the option
--     is on or off.
--   * service_role (webhooks, cron, Robin's read-only PAT) — bypasses
--     RLS entirely regardless of view setting.
-- No browser code SELECTs these views directly (verified with grep on
-- lib/**/*.ts and app/**/*.tsx).
--
-- Flipping to invoker=true means a hypothetical direct-select from an
-- authenticated user would be subject to RLS on the underlying tables
-- instead of silently bypassing it. That's what the advisor wants.
--
-- Post-fix smoke test (all still returning data):
--   v_all_orders                  146,957 rows
--   get_dispatch_alerts()         OK
--   get_campaign_stats_v3()       16 rows
--   get_campaigns_list()          16 rows
--   get_campaign_products_v2(1)   36 rows
--   home_dashboard_impl().combined.revenue  $12.36M

alter view aa_01_campaigns.v_all_orders                  set (security_invoker = true);
alter view aa_01_campaigns.v_raw_order_line_attribution  set (security_invoker = true);
alter view aa_01_campaigns.v_payhere_undispatched        set (security_invoker = true);
alter view aa_01_campaigns.v_gumroad_unmapped            set (security_invoker = true);
