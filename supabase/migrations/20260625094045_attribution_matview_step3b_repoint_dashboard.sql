-- Repoint build_home_dashboard_payload to the matview by transforming its own
-- current definition — only the relation name changes, nothing else can drift.
DO $do$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.build_home_dashboard_payload()'::regprocedure) INTO v_def;
  v_def := replace(
    v_def,
    'aa_01_campaigns.v_raw_order_line_attribution',
    'aa_01_campaigns.mv_raw_order_line_attribution'
  );
  EXECUTE v_def;
END
$do$;
