-- Two surfaces, both gated by the same gap: the customer screens hadn't
-- been told about indiegogo / kickstarter / wix / shopify_legacy
-- attribution that lives on historic_order_lines.campaign_id and
-- historic_orders. Without these patches a customer whose only orders
-- were historical showed up with an empty Campaigns column on the list
-- and "No order details found" on drill-down.
--
-- Two changes:
-- 1. get_customer_campaign_orders: add a 4th UNION branch that joins
--    historic_orders + historic_order_lines. No NOT EXISTS guard
--    needed — historic rows don't overlap with raw_orders /
--    v_crm_customer_purchases / isod_orders paths.
-- 2. get_customers_list: surface historic_orders_detail in the
--    RETURNS TABLE, use it for the campaign-id filter, and recognise
--    indiegogo + kickstarter as store-filter values.

CREATE OR REPLACE FUNCTION public.get_customer_campaign_orders(
  p_email text,
  p_campaign_id integer
)
RETURNS TABLE(
  product_name text,
  variant_name text,
  quantity integer,
  price_paid numeric,
  order_id text,
  order_number text,
  purchase_type text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_01_campaigns', 'aa_02_crm'
AS $function$
  SELECT
    (li->>'title')::text                              AS product_name,
    NULLIF(TRIM(li->>'variant_title'), '')            AS variant_name,
    (li->>'quantity')::integer                        AS quantity,
    (li->>'price')::numeric                           AS price_paid,
    ro.shopify_order_id                               AS order_id,
    ro.shopify_order_number                           AS order_number,
    'shopify'::text                                   AS purchase_type
  FROM aa_01_campaigns.raw_orders ro,
       jsonb_array_elements(ro.payload->'line_items') AS li
  WHERE ro.campaign_id = p_campaign_id
    AND lower(TRIM(ro.email)) = lower(TRIM(p_email))
    AND ro.financial_status = 'paid'

  UNION ALL

  SELECT
    p.title_at_purchase                               AS product_name,
    NULLIF(TRIM(p.variant_title_at_purchase), '')     AS variant_name,
    p.quantity,
    p.price_paid,
    p.shopify_order_id                                AS order_id,
    p.shopify_order_id                                AS order_number,
    p.purchase_type
  FROM aa_01_campaigns.v_crm_customer_purchases p
  WHERE p.campaign_id = p_campaign_id
    AND lower(TRIM(p.email)) = lower(TRIM(p_email))
    AND NOT EXISTS (
      SELECT 1 FROM aa_01_campaigns.raw_orders
      WHERE campaign_id = p_campaign_id LIMIT 1
    )

  UNION ALL

  SELECT
    iol.sku_after_correction                          AS product_name,
    NULL::text                                        AS variant_name,
    1::integer                                        AS quantity,
    iol.price_paid                                    AS price_paid,
    io.order_id                                       AS order_id,
    io.purchase_order_number                          AS order_number,
    'isod'::text                                      AS purchase_type
  FROM aa_01_campaigns.isod_orders io
  JOIN aa_01_campaigns.isod_order_lines iol ON iol.isod_order_id = io.id
  WHERE io.campaign_id = p_campaign_id
    AND lower(TRIM(io.customer_email)) = lower(TRIM(p_email))
    AND NOT EXISTS (
      SELECT 1 FROM aa_01_campaigns.raw_orders
      WHERE campaign_id = p_campaign_id LIMIT 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM aa_01_campaigns.order_entitlements
      WHERE campaign_id = p_campaign_id LIMIT 1
    )

  UNION ALL

  -- Historic branch: indiegogo, kickstarter, wix, shopify_legacy, gumroad.
  SELECT
    hol.product_name_raw                              AS product_name,
    NULL::text                                        AS variant_name,
    coalesce(hol.quantity, 1)                         AS quantity,
    coalesce(hol.line_revenue, 0)::numeric            AS price_paid,
    ho.source_order_id                                AS order_id,
    ho.source_order_id                                AS order_number,
    ho.source_platform                                AS purchase_type
  FROM aa_01_campaigns.historic_orders ho
  JOIN aa_01_campaigns.historic_order_lines hol ON hol.historic_order_id = ho.id
  WHERE hol.campaign_id = p_campaign_id
    AND ho.order_status = 'paid'
    AND lower(TRIM(ho.email)) = lower(TRIM(p_email))

  ORDER BY order_number NULLS LAST, product_name
$function$;

REVOKE ALL ON FUNCTION public.get_customer_campaign_orders(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_campaign_orders(text, integer) TO anon, authenticated;


-- Drop first because RETURNS TABLE gains a column.
DROP FUNCTION IF EXISTS public.get_customers_list(text, integer, integer, bigint[], text[], boolean);

CREATE OR REPLACE FUNCTION public.get_customers_list(
  p_search text DEFAULT NULL::text,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50,
  p_campaign_ids bigint[] DEFAULT NULL::bigint[],
  p_stores text[] DEFAULT NULL::text[],
  p_include_unpaid boolean DEFAULT false
)
RETURNS TABLE(
  id bigint,
  email text,
  full_name text,
  total_orders integer,
  total_spend numeric,
  shipping_city text,
  shipping_country text,
  is_backer boolean,
  campaign_orders_detail jsonb,
  raw_orders_detail jsonb,
  isod_orders_detail jsonb,
  historic_orders_detail jsonb,
  total_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_01_campaigns', 'aa_02_crm'
AS $function$
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
  indiegogo_emails AS (
    SELECT DISTINCT lower(email) AS email FROM aa_01_campaigns.historic_orders
     WHERE source_platform='indiegogo' AND order_status='paid' AND email IS NOT NULL
  ),
  kickstarter_emails AS (
    SELECT DISTINCT lower(email) AS email FROM aa_01_campaigns.historic_orders
     WHERE source_platform='kickstarter' AND order_status='paid' AND email IS NOT NULL
  ),
  enriched AS (
    SELECT
      cs.id, lower(cs.email) AS email, cs.full_name, cs.total_orders,
      coalesce(rs.spend, cs.total_spend, 0) AS total_spend,
      cs.shipping_city, cs.shipping_country, cs.is_backer,
      cs.campaign_orders_detail, cs.raw_orders_detail, cs.isod_orders_detail,
      cs.historic_orders_detail
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
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(cs.historic_orders_detail, '[]')) d
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
        OR ('indiegogo' = ANY(p_stores) AND EXISTS (SELECT 1 FROM indiegogo_emails ie WHERE ie.email=lower(cs.email)))
        OR ('kickstarter' = ANY(p_stores) AND EXISTS (SELECT 1 FROM kickstarter_emails ke WHERE ke.email=lower(cs.email)))
      )
    )
  )
  SELECT
    e.id, e.email, e.full_name, e.total_orders, e.total_spend,
    e.shipping_city, e.shipping_country, e.is_backer,
    e.campaign_orders_detail, e.raw_orders_detail, e.isod_orders_detail,
    e.historic_orders_detail,
    count(*) OVER()::bigint AS total_count
  FROM enriched e
  ORDER BY e.total_spend DESC NULLS LAST
  LIMIT p_page_size
  OFFSET (p_page - 1) * p_page_size
$function$;

REVOKE ALL ON FUNCTION public.get_customers_list(text, integer, integer, bigint[], text[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customers_list(text, integer, integer, bigint[], text[], boolean) TO anon, authenticated;
