-- ── Part 1: fix customer_list_snapshot.total_spend ─────────────
-- Same bug as get_customer_detail had: refresh proc was overriding
-- cs.total_spend with a raw_orders-only line-item sum, silently
-- truncating spend for anyone with paid live-Shopify orders. Use
-- cs.total_spend (already canonical across all four sources).
CREATE OR REPLACE FUNCTION aa_02_crm.refresh_customer_list_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_01_campaigns', 'aa_02_crm'
AS $$
begin
  TRUNCATE aa_02_crm.customer_list_snapshot;
  INSERT INTO aa_02_crm.customer_list_snapshot (
    id, email, full_name, total_orders, total_spend,
    shipping_city, shipping_country, is_backer,
    campaign_orders_detail, raw_orders_detail, isod_orders_detail, historic_orders_detail,
    campaign_ids, source_platforms, search_text, refreshed_at
  )
  WITH paying AS (
    SELECT email FROM aa_02_crm.v_paying_customer_emails
  )
  SELECT
    cs.id, cs.email, cs.full_name, cs.total_orders,
    coalesce(cs.total_spend, 0) AS total_spend,
    cs.shipping_city, cs.shipping_country, cs.is_backer,
    cs.campaign_orders_detail, cs.raw_orders_detail,
    cs.isod_orders_detail, cs.historic_orders_detail,
    (
      SELECT array_agg(DISTINCT (d->>'campaign_id')::int)
      FROM (
        SELECT jsonb_array_elements(coalesce(cs.campaign_orders_detail, '[]'::jsonb)) AS d
        UNION ALL
        SELECT jsonb_array_elements(coalesce(cs.raw_orders_detail, '[]'::jsonb))
        UNION ALL
        SELECT jsonb_array_elements(coalesce(cs.isod_orders_detail, '[]'::jsonb))
        UNION ALL
        SELECT jsonb_array_elements(coalesce(cs.historic_orders_detail, '[]'::jsonb))
      ) flat
      WHERE d ? 'campaign_id'
    ) AS campaign_ids,
    (
      SELECT array_agg(DISTINCT plat)
      FROM (
        SELECT CASE WHEN jsonb_array_length(coalesce(cs.raw_orders_detail, '[]'::jsonb)) > 0
                    THEN 'shopify' END AS plat
        UNION ALL
        SELECT CASE WHEN jsonb_array_length(coalesce(cs.isod_orders_detail, '[]'::jsonb)) > 0
                    THEN 'isod' END
        UNION ALL
        SELECT DISTINCT d->>'source'
        FROM jsonb_array_elements(coalesce(cs.historic_orders_detail, '[]'::jsonb)) d
        WHERE d ? 'source'
      ) flat
      WHERE plat IS NOT NULL
    ) AS source_platforms,
    coalesce(lower(cs.email), '') || ' ' || coalesce(lower(cs.full_name), '') AS search_text,
    now() AS refreshed_at
  FROM aa_02_crm.customer_summary cs
  INNER JOIN paying p ON p.email = lower(cs.email);
end;
$$;

-- ── Part 2: campaigns_list_snapshot ────────────────────────────
-- get_campaign_stats_v3() takes ~10s and was blowing through
-- Vercel's 10s function ceiling on every cold-cache hit. The
-- /campaigns page also depends on get_campaigns_historic_totals()
-- (~1s) and getCampaigns() to surface zero-order campaigns.
-- Bake the merged result into one snapshot, refreshed every 10
-- minutes by pg_cron. App reads it via a thin SELECT (3.8ms).
CREATE TABLE IF NOT EXISTS aa_02_crm.campaigns_list_snapshot (
  campaign_id      int PRIMARY KEY,
  campaign_name    text NOT NULL,
  legacy_code      text,
  total_orders     int NOT NULL DEFAULT 0,
  total_customers  int NOT NULL DEFAULT 0,
  total_revenue    numeric NOT NULL DEFAULT 0,
  has_historic     boolean NOT NULL DEFAULT false,
  refreshed_at     timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON aa_02_crm.campaigns_list_snapshot TO anon, authenticated;

-- The campaigns table column is "Name" (quoted, capital N).
CREATE OR REPLACE FUNCTION aa_02_crm.refresh_campaigns_list_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_01_campaigns', 'aa_02_crm'
AS $$
begin
  TRUNCATE aa_02_crm.campaigns_list_snapshot;
  INSERT INTO aa_02_crm.campaigns_list_snapshot (
    campaign_id, campaign_name, legacy_code,
    total_orders, total_customers, total_revenue, has_historic, refreshed_at
  )
  WITH live AS (
    SELECT campaign_id, total_orders, total_customers, total_spend
    FROM public.get_campaign_stats_v3()
  ),
  hist AS (
    SELECT campaign_id, orders, revenue
    FROM public.get_campaigns_historic_totals()
  )
  SELECT
    c.id::int                                AS campaign_id,
    c."Name"                                 AS campaign_name,
    c.legacy_code                            AS legacy_code,
    COALESCE(l.total_orders, 0)::int         AS total_orders,
    COALESCE(l.total_customers, 0)::int      AS total_customers,
    (COALESCE(l.total_spend, 0) + COALESCE(h.revenue, 0))::numeric AS total_revenue,
    (COALESCE(h.orders, 0) > 0)              AS has_historic,
    now()                                    AS refreshed_at
  FROM aa_01_campaigns.campaigns c
  LEFT JOIN live l ON l.campaign_id = c.id
  LEFT JOIN hist h ON h.campaign_id = c.id;
end;
$$;

CREATE OR REPLACE FUNCTION public.refresh_campaigns_list_snapshot()
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_02_crm'
AS $$ SELECT aa_02_crm.refresh_campaigns_list_snapshot(); $$;

REVOKE ALL ON FUNCTION public.refresh_campaigns_list_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_campaigns_list_snapshot() TO service_role, authenticated;

-- ── Part 3: reader RPC for the app ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_campaigns_list()
RETURNS TABLE(
  campaign_id     int,
  campaign_name   text,
  legacy_code     text,
  total_orders    int,
  total_customers int,
  total_revenue   numeric,
  has_historic    boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_02_crm'
AS $$
  SELECT
    campaign_id, campaign_name, legacy_code,
    total_orders, total_customers, total_revenue, has_historic
  FROM aa_02_crm.campaigns_list_snapshot
  ORDER BY total_revenue DESC NULLS LAST, campaign_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_campaigns_list() TO anon, authenticated, service_role;

-- ── Part 4: initial population + cron schedule ─────────────────
SELECT aa_02_crm.refresh_campaigns_list_snapshot();
SELECT aa_02_crm.refresh_customer_list_snapshot();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'refresh-campaigns-list-snapshot'
  ) THEN
    PERFORM cron.schedule(
      'refresh-campaigns-list-snapshot',
      '1,11,21,31,41,51 * * * *',
      $cron$SELECT public.refresh_campaigns_list_snapshot();$cron$
    );
  END IF;
END$$;
