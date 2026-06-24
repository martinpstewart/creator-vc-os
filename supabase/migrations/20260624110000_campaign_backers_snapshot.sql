-- get_campaign_backer_list_combined() takes ~15.86s for campaign 1
-- (the CROSS JOIN LATERAL over raw_orders.payload->'line_items' is
-- the cost — 124k orders, 3-5 lines each). It runs on every campaign
-- detail page load AND every pagination click, blowing through
-- Vercel's 10s function ceiling.
--
-- Pre-aggregate the backer list per campaign into one snapshot table,
-- refreshed every 10 min by pg_cron. App reads paginated + searched
-- via a thin SELECT with trigram index for ILIKE.

CREATE TABLE IF NOT EXISTS aa_02_crm.campaign_backers_snapshot (
  campaign_id  int         NOT NULL,
  email        text        NOT NULL,
  full_name    text,
  total_spend  numeric,
  order_count  bigint      NOT NULL DEFAULT 0,
  search_text  text        NOT NULL DEFAULT '',
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, email)
);
GRANT SELECT ON aa_02_crm.campaign_backers_snapshot TO anon, authenticated;

-- Default ordering: spend DESC, then email tiebreak. Composite index so
-- WHERE campaign_id = ? ORDER BY total_spend DESC NULLS LAST is an
-- index-only scan.
CREATE INDEX IF NOT EXISTS campaign_backers_snapshot_spend_idx
  ON aa_02_crm.campaign_backers_snapshot (campaign_id, total_spend DESC NULLS LAST, email);

CREATE INDEX IF NOT EXISTS campaign_backers_snapshot_search_trgm
  ON aa_02_crm.campaign_backers_snapshot USING gin (search_text gin_trgm_ops);

-- ── Refresh proc ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION aa_02_crm.refresh_campaign_backers_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_01_campaigns', 'aa_02_crm'
AS $$
begin
  TRUNCATE aa_02_crm.campaign_backers_snapshot;
  INSERT INTO aa_02_crm.campaign_backers_snapshot (
    campaign_id, email, full_name, total_spend, order_count, search_text, refreshed_at
  )
  WITH backer_spend AS (
    -- raw_orders: PAID Shopify line revenue per (campaign, email)
    SELECT
      ro.campaign_id,
      lower(TRIM(ro.email)) AS email,
      SUM((li->>'price')::numeric * (li->>'quantity')::integer) AS spend,
      COUNT(DISTINCT ro.id)::bigint AS orders
    FROM aa_01_campaigns.raw_orders ro
    CROSS JOIN LATERAL jsonb_array_elements(ro.payload->'line_items') AS li
    WHERE ro.financial_status = 'paid'
      AND ro.email IS NOT NULL AND ro.email <> ''
    GROUP BY ro.campaign_id, lower(TRIM(ro.email))

    UNION ALL

    -- order_entitlements (cross-sell) — only when raw_orders has none
    -- for that campaign.
    SELECT
      oe.campaign_id,
      lower(TRIM(oe.email)) AS email,
      SUM(oe.price_paid)    AS spend,
      COUNT(DISTINCT oe.shopify_order_id)::bigint AS orders
    FROM aa_01_campaigns.order_entitlements oe
    WHERE oe.email IS NOT NULL AND oe.email <> ''
      AND NOT EXISTS (
        SELECT 1 FROM aa_01_campaigns.raw_orders r
        WHERE r.campaign_id = oe.campaign_id LIMIT 1
      )
    GROUP BY oe.campaign_id, lower(TRIM(oe.email))

    UNION ALL

    -- ISOD — only when neither raw_orders nor order_entitlements has
    -- coverage for this campaign.
    SELECT
      io.campaign_id,
      lower(TRIM(io.customer_email)) AS email,
      SUM(iol.price_paid)            AS spend,
      COUNT(DISTINCT io.id)::bigint  AS orders
    FROM aa_01_campaigns.isod_orders io
    LEFT JOIN aa_01_campaigns.isod_order_lines iol ON iol.isod_order_id = io.id
    WHERE io.customer_email IS NOT NULL AND io.customer_email <> ''
      AND NOT EXISTS (
        SELECT 1 FROM aa_01_campaigns.raw_orders
        WHERE campaign_id = io.campaign_id LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM aa_01_campaigns.order_entitlements
        WHERE campaign_id = io.campaign_id LIMIT 1
      )
    GROUP BY io.campaign_id, lower(TRIM(io.customer_email))

    UNION ALL

    -- Historic CSV imports (gumroad / shopify_legacy / wix). Always
    -- counted alongside live activity (FPS cross-sells etc).
    SELECT
      hol.campaign_id,
      lower(TRIM(ho.email)) AS email,
      SUM(hol.line_revenue) AS spend,
      COUNT(DISTINCT ho.id)::bigint AS orders
    FROM aa_01_campaigns.historic_order_lines hol
    JOIN aa_01_campaigns.historic_orders ho ON ho.id = hol.historic_order_id
    WHERE ho.order_status = 'paid'
      AND ho.email IS NOT NULL AND ho.email <> ''
      AND hol.campaign_id IS NOT NULL
    GROUP BY hol.campaign_id, lower(TRIM(ho.email))
  ),
  aggregated AS (
    SELECT
      bs.campaign_id,
      bs.email,
      SUM(bs.spend)  AS total_spend,
      SUM(bs.orders) AS order_count
    FROM backer_spend bs
    GROUP BY bs.campaign_id, bs.email
  )
  SELECT
    a.campaign_id,
    a.email,
    cs.full_name,
    a.total_spend,
    a.order_count,
    coalesce(a.email, '') || ' ' || coalesce(lower(cs.full_name), '') AS search_text,
    now() AS refreshed_at
  FROM aggregated a
  LEFT JOIN aa_02_crm.customer_summary cs ON lower(cs.email) = a.email;
end;
$$;

-- Public wrapper for cron + admin manual refresh
CREATE OR REPLACE FUNCTION public.refresh_campaign_backers_snapshot()
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_02_crm'
AS $$ SELECT aa_02_crm.refresh_campaign_backers_snapshot(); $$;
REVOKE ALL ON FUNCTION public.refresh_campaign_backers_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_campaign_backers_snapshot() TO service_role, authenticated;

-- ── Reader RPC: search + pagination ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_campaign_backers_list(
  p_campaign_id int,
  p_search      text DEFAULT NULL,
  p_page        int  DEFAULT 1,
  p_page_size   int  DEFAULT 100
)
RETURNS TABLE(
  email       text,
  full_name   text,
  total_spend numeric,
  order_count bigint,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_02_crm'
AS $$
  WITH filtered AS (
    SELECT email, full_name, total_spend, order_count
    FROM aa_02_crm.campaign_backers_snapshot
    WHERE campaign_id = p_campaign_id
      AND (
        p_search IS NULL
        OR length(btrim(p_search)) = 0
        OR search_text ILIKE '%' || lower(btrim(p_search)) || '%'
      )
  )
  SELECT
    email, full_name, total_spend, order_count,
    COUNT(*) OVER()::bigint AS total_count
  FROM filtered
  ORDER BY total_spend DESC NULLS LAST, email
  LIMIT p_page_size
  OFFSET (p_page - 1) * p_page_size;
$$;

GRANT EXECUTE ON FUNCTION public.get_campaign_backers_list(int, text, int, int) TO anon, authenticated, service_role;

-- ── Initial populate + cron schedule ───────────────────────────
SELECT aa_02_crm.refresh_campaign_backers_snapshot();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-campaign-backers-snapshot') THEN
    PERFORM cron.schedule(
      'refresh-campaign-backers-snapshot',
      '2,12,22,32,42,52 * * * *',
      $cron$SELECT public.refresh_campaign_backers_snapshot();$cron$
    );
  END IF;
END$$;
