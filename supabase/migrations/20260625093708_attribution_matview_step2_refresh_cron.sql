-- Cron-callable wrapper for REFRESH MATERIALIZED VIEW CONCURRENTLY.
-- Granted to anon/authenticated per the project's RPC permission rule.
-- Cron job 10 fires it at minutes 7, 22, 37, 52 (off-tick from the
-- snapshot refresh jobs).
CREATE OR REPLACE FUNCTION public.refresh_attribution_matview()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','aa_01_campaigns'
AS $function$
  REFRESH MATERIALIZED VIEW CONCURRENTLY aa_01_campaigns.mv_raw_order_line_attribution;
$function$;

GRANT EXECUTE ON FUNCTION public.refresh_attribution_matview() TO anon, authenticated;

SELECT cron.schedule(
  'refresh-attribution-matview',
  '7,22,37,52 * * * *',
  'SELECT public.refresh_attribution_matview();'
);
