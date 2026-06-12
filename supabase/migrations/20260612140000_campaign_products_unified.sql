-- A single per-campaign product list that excavates from every source
-- we now reconcile in the dashboard / campaigns list:
--   1) Live Shopify lines from v_raw_order_line_attribution
--      (product_name + variant_name, quantity, line_revenue)
--   2) Historic CSV-import lines from historic_order_lines
--      (product_name_raw, quantity, line_revenue, source_platform tag)
--   3) ISOD lines from isod_order_lines, identified by sku_after_correction
--      (no variant or human title — SKU is the product identifier)
--
-- The campaign detail Products tab used to merge (1) + (2) only and showed
-- units only. With ISOD revenue + line data now in scope, this RPC gives
-- the tab a complete list of every product Robin can ladder back to the
-- per-source totals on the dashboard / campaigns list.
--
-- Returns at most a few thousand rows per campaign (we cap at top 100 by
-- units to keep payload small — the long tail is mostly Logo-XL T-shirt
-- variants on ISOD and isn't useful to surface in a list view).

CREATE OR REPLACE FUNCTION public.get_campaign_products_v2(p_campaign_id bigint)
RETURNS TABLE(
  product_name    text,
  variant_name    text,
  source_platform text,
  units           integer,
  revenue         numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, aa_01_campaigns
AS $$
  WITH live AS (
    SELECT
      v.product_name,
      v.variant_name,
      'shopify'::text AS source_platform,
      sum(v.quantity)::int AS units,
      sum(v.line_revenue)::numeric AS revenue
    FROM aa_01_campaigns.v_raw_order_line_attribution v
    WHERE v.financial_status = 'paid'
      AND v.product_campaign_id = p_campaign_id
      AND v.product_name IS NOT NULL
    GROUP BY v.product_name, v.variant_name
  ),
  historic AS (
    SELECT
      hol.product_name_raw AS product_name,
      NULL::text AS variant_name,
      ho.source_platform,
      sum(hol.quantity)::int AS units,
      sum(hol.line_revenue)::numeric AS revenue
    FROM aa_01_campaigns.historic_order_lines hol
    JOIN aa_01_campaigns.historic_orders ho ON ho.id = hol.historic_order_id
    WHERE ho.order_status = 'paid'
      AND hol.campaign_id = p_campaign_id
      AND hol.product_name_raw IS NOT NULL
    GROUP BY hol.product_name_raw, ho.source_platform
  ),
  isod AS (
    -- ISOD lines have no human title or variant — sku_after_correction is
    -- the product identifier. Each row is one shipped item (no qty col).
    SELECT
      l.sku_after_correction AS product_name,
      NULL::text AS variant_name,
      'isod'::text AS source_platform,
      count(*)::int AS units,
      coalesce(sum(l.price_paid), 0)::numeric AS revenue
    FROM aa_01_campaigns.isod_order_lines l
    JOIN aa_01_campaigns.isod_orders io ON io.id = l.isod_order_id
    WHERE io.campaign_id = p_campaign_id
      AND l.sku_after_correction IS NOT NULL
    GROUP BY l.sku_after_correction
  )
  SELECT product_name, variant_name, source_platform, units, revenue
  FROM (
    SELECT * FROM live
    UNION ALL
    SELECT * FROM historic
    UNION ALL
    SELECT * FROM isod
  ) all_sources
  ORDER BY units DESC NULLS LAST, revenue DESC NULLS LAST
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.get_campaign_products_v2(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_products_v2(bigint) TO anon, authenticated;
