-- The EXISTS subquery against aa_02_crm.v_paying_customer_emails was
-- forcing the planner to re-evaluate the view for every customer_summary
-- row. customer_summary itself is a heavy view (many jsonb_agg
-- subqueries), so the combined cost timed out at 8s+.
--
-- Rewriting as: compute paying emails ONCE in a CTE, then LEFT JOIN.
-- p_include_unpaid still short-circuits the gate. Hash-built once,
-- probed in linear time — ~milliseconds instead of timeout.
CREATE OR REPLACE FUNCTION public.get_customers_list(
  p_search text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50,
  p_campaign_ids bigint[] DEFAULT NULL,
  p_stores text[] DEFAULT NULL,
  p_include_unpaid boolean DEFAULT false
)
RETURNS TABLE(
  id bigint, email text, full_name text, total_orders integer,
  total_spend numeric, shipping_city text, shipping_country text,
  is_backer boolean, campaign_orders_detail jsonb, raw_orders_detail jsonb,
  isod_orders_detail jsonb, total_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, aa_01_campaigns, aa_02_crm
AS $$
  WITH paying AS (
    SELECT email FROM aa_02_crm.v_paying_customer_emails
  ),
  raw_spend AS (
    SELECT
      lower(btrim(ro.email)) AS email,
      sum((li->>'price')::numeric * (li->>'quantity')::integer) AS spend
    FROM aa_01_campaigns.raw_orders ro
    CROSS JOIN LATERAL jsonb_array_elements(ro.payload->'line_items') AS li
    WHERE ro.financial_status = 'paid'
    GROUP BY lower(btrim(ro.email))
  ),
  gumroad_emails AS (
    SELECT DISTINCT lower(email) AS email FROM aa_01_campaigns.historic_orders
     WHERE source_platform='gumroad' AND order_status='paid' AND email IS NOT NULL
  ),
  wix_emails AS (
    SELECT DISTINCT lower(email) AS email FROM aa_01_campaigns.historic_orders
     WHERE source_platform='wix' AND order_status='paid' AND email IS NOT NULL
  ),
  shopify_legacy_emails AS (
    SELECT DISTINCT lower(email) AS email FROM aa_01_campaigns.historic_orders
     WHERE source_platform='shopify_legacy' AND order_status='paid' AND email IS NOT NULL
  ),
  enriched AS (
    SELECT
      cs.id, lower(cs.email) AS email, cs.full_name, cs.total_orders,
      coalesce(rs.spend, cs.total_spend, 0) AS total_spend,
      cs.shipping_city, cs.shipping_country, cs.is_backer,
      cs.campaign_orders_detail, cs.raw_orders_detail, cs.isod_orders_detail
    FROM aa_02_crm.customer_summary cs
    LEFT JOIN paying p ON p.email = lower(cs.email)
    LEFT JOIN raw_spend rs ON rs.email = lower(cs.email)
    WHERE (p_include_unpaid OR p.email IS NOT NULL)
    AND (
      p_search IS NULL
      OR cs.email ILIKE '%' || p_search || '%'
      OR cs.full_name ILIKE '%' || p_search || '%'
    )
    AND (
      p_campaign_ids IS NULL
      OR cardinality(p_campaign_ids) = 0
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(cs.campaign_orders_detail, '[]')) d
                  WHERE (d->>'campaign_id')::bigint = ANY(p_campaign_ids))
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(cs.raw_orders_detail, '[]')) d
                  WHERE (d->>'campaign_id')::bigint = ANY(p_campaign_ids))
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(cs.isod_orders_detail, '[]')) d
                  WHERE (d->>'campaign_id')::bigint = ANY(p_campaign_ids))
    )
    AND (
      p_stores IS NULL
      OR cardinality(p_stores) = 0
      OR (
        ('shopify' = ANY(p_stores) AND jsonb_array_length(coalesce(cs.raw_orders_detail, '[]')) > 0)
        OR ('isod' = ANY(p_stores) AND jsonb_array_length(coalesce(cs.isod_orders_detail, '[]')) > 0)
        OR ('gumroad' = ANY(p_stores) AND EXISTS (SELECT 1 FROM gumroad_emails ge WHERE ge.email=lower(cs.email)))
        OR ('wix' = ANY(p_stores) AND EXISTS (SELECT 1 FROM wix_emails we WHERE we.email=lower(cs.email)))
        OR ('shopify_legacy' = ANY(p_stores) AND EXISTS (SELECT 1 FROM shopify_legacy_emails sle WHERE sle.email=lower(cs.email)))
      )
    )
  )
  SELECT
    e.id, e.email, e.full_name, e.total_orders, e.total_spend,
    e.shipping_city, e.shipping_country, e.is_backer,
    e.campaign_orders_detail, e.raw_orders_detail, e.isod_orders_detail,
    count(*) OVER()::bigint AS total_count
  FROM enriched e
  ORDER BY e.total_spend DESC NULLS LAST
  LIMIT p_page_size
  OFFSET (p_page - 1) * p_page_size
$$;

REVOKE ALL ON FUNCTION public.get_customers_list(text, integer, integer, bigint[], text[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customers_list(text, integer, integer, bigint[], text[], boolean) TO anon, authenticated;
