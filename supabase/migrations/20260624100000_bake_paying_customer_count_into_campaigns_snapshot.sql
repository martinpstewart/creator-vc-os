-- get_paying_customer_count() takes ~2.95s (UNION-DISTINCT across
-- raw_orders (124k) + historic_orders (101k) + isod_orders). It was
-- the dominant cost left on /campaigns after the snapshot fix. Bake
-- the count into the same snapshot refresh cycle so the page becomes
-- one DB call. Denormalised across all rows (only 14) — trivial.

ALTER TABLE aa_02_crm.campaigns_list_snapshot
  ADD COLUMN IF NOT EXISTS paying_customer_count int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION aa_02_crm.refresh_campaigns_list_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_01_campaigns', 'aa_02_crm'
AS $$
declare
  v_paying_count int;
begin
  -- Compute once per refresh, copy across all rows. The UNION-DISTINCT
  -- runs at 10-min cadence here instead of on every page render.
  SELECT count(*)::int INTO v_paying_count
  FROM aa_02_crm.v_paying_customer_emails;

  TRUNCATE aa_02_crm.campaigns_list_snapshot;
  INSERT INTO aa_02_crm.campaigns_list_snapshot (
    campaign_id, campaign_name, legacy_code,
    total_orders, total_customers, total_revenue, has_historic,
    paying_customer_count, refreshed_at
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
    v_paying_count                           AS paying_customer_count,
    now()                                    AS refreshed_at
  FROM aa_01_campaigns.campaigns c
  LEFT JOIN live l ON l.campaign_id = c.id
  LEFT JOIN hist h ON h.campaign_id = c.id;
end;
$$;

-- Reader RPC: now returns paying_customer_count alongside the rows.
-- App reads it from row[0] (or any row — same value across all 14).
DROP FUNCTION IF EXISTS public.get_campaigns_list();
CREATE FUNCTION public.get_campaigns_list()
RETURNS TABLE(
  campaign_id           int,
  campaign_name         text,
  legacy_code           text,
  total_orders          int,
  total_customers       int,
  total_revenue         numeric,
  has_historic          boolean,
  paying_customer_count int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_02_crm'
AS $$
  SELECT
    campaign_id, campaign_name, legacy_code,
    total_orders, total_customers, total_revenue, has_historic,
    paying_customer_count
  FROM aa_02_crm.campaigns_list_snapshot
  ORDER BY total_revenue DESC NULLS LAST, campaign_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_campaigns_list() TO anon, authenticated, service_role;

-- Refresh now so the new column is populated immediately
SELECT aa_02_crm.refresh_campaigns_list_snapshot();
