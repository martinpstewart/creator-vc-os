-- Repoint the five remaining functions + the v_all_orders view from
-- v_raw_order_line_attribution to mv_raw_order_line_attribution.
--
-- Decision per target — all 6 are analytics surfaces, none read on a
-- path that has to reflect a fresh order within seconds. 15-min
-- matview staleness is fine.
--
--   get_campaign_backer_list_v2  → no app callers (replaced by
--                                  _combined/snapshot). Repoint for
--                                  hygiene.
--   get_campaign_products_v2     → /campaigns/[id] Products tab.
--                                  Analytics rollup.
--   get_campaign_stats_v2        → no app callers (v3 is the only
--                                  active one). Repoint for hygiene.
--   get_campaign_units_sold      → no app callers. Hygiene.
--   get_campaign_units_sold_v2   → catalogue per-product units strip.
--                                  Analytics.
--   v_all_orders                 → nl-query Ask schema-context view
--                                  (BI questions). Analytics.
--
-- Mechanism: pull each object's own definition, regex-replace the
-- relation name with \m...\M word boundaries (catches both schema-
-- qualified FROMs *and* bare column references like
-- v_raw_order_line_attribution.col, without colliding with the
-- already-prefixed mv_raw_order_line_attribution), recreate. Zero
-- transcription risk.

DO $do$
DECLARE
  v_def text;
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_campaign_backer_list_v2(integer,integer,integer)',
    'public.get_campaign_products_v2(bigint)',
    'public.get_campaign_stats_v2()',
    'public.get_campaign_units_sold(integer)',
    'public.get_campaign_units_sold_v2(integer)'
  ]
  LOOP
    v_def := pg_get_functiondef(v_sig::regprocedure);
    v_def := regexp_replace(
      v_def,
      '\mv_raw_order_line_attribution\M',
      'mv_raw_order_line_attribution',
      'g'
    );
    EXECUTE v_def;
  END LOOP;
END
$do$;

-- v_all_orders is a view — pull its body and recreate with the same
-- regex swap. The body uses bare `v_raw_order_line_attribution.col`
-- references (no table alias), which is why we can't just replace
-- the schema-qualified FROM string.
DO $do$
DECLARE
  v_body text;
BEGIN
  v_body := pg_get_viewdef('aa_01_campaigns.v_all_orders'::regclass);
  v_body := regexp_replace(
    v_body,
    '\mv_raw_order_line_attribution\M',
    'mv_raw_order_line_attribution',
    'g'
  );
  EXECUTE 'CREATE OR REPLACE VIEW aa_01_campaigns.v_all_orders AS ' || v_body;
END
$do$;
