-- ============================================================
-- Canonical "paying customer" + "campaign backers" definitions.
--
-- BEFORE: every screen had its own dedupe story.
--   - Home headline    = 22,944  (raw_orders.paid ∪ historic_orders.paid)
--   - Customers page   = 27,974  (all known emails, paid or not)
--   - Campaigns page   = 31,573  (per-campaign distinct summed → overcounts)
--   - Campaign detail  =  4,120  for Aliens (via attribution view)
--   - Ask query        =  4,121  for Aliens (via raw_orders directly)
--
-- AFTER:
--   - aa_02_crm.v_paying_customer_emails  → ONE list of paying emails.
--   - aa_02_crm.v_campaign_paying_emails  → ONE (campaign, email) list.
--     Both are used everywhere a number is reported.
--
-- ISOD = In Search of Darkness campaign 5 — Backerkit-fulfilled orders,
-- paid by definition (the import only carries fulfilled records). Was
-- previously excluded from the home headline; now included.
-- ============================================================

-- 1. Distinct paying emails across every order source.
CREATE OR REPLACE VIEW aa_02_crm.v_paying_customer_emails AS
SELECT lower(btrim(email)) AS email
  FROM aa_01_campaigns.raw_orders
 WHERE financial_status = 'paid'
   AND email IS NOT NULL
   AND btrim(email) <> ''
UNION
SELECT lower(btrim(email))
  FROM aa_01_campaigns.historic_orders
 WHERE order_status = 'paid'
   AND email IS NOT NULL
   AND btrim(email) <> ''
UNION
SELECT lower(btrim(customer_email))
  FROM aa_01_campaigns.isod_orders
 WHERE customer_email IS NOT NULL
   AND btrim(customer_email) <> '';

GRANT SELECT ON aa_02_crm.v_paying_customer_emails TO authenticated;

-- 2. Per-campaign paying-customer rows. Mirrors get_campaign_backer_list_combined
-- so the counts here exactly match what the backer list page renders.
CREATE OR REPLACE VIEW aa_02_crm.v_campaign_paying_emails AS
  SELECT campaign_id::bigint AS campaign_id,
         lower(btrim(email))  AS email
    FROM aa_01_campaigns.raw_orders
   WHERE financial_status = 'paid'
     AND email IS NOT NULL
     AND btrim(email) <> ''
   GROUP BY campaign_id, lower(btrim(email))
  UNION
  SELECT oe.campaign_id::bigint,
         lower(btrim(oe.email))
    FROM aa_01_campaigns.order_entitlements oe
   WHERE oe.email IS NOT NULL
     AND btrim(oe.email) <> ''
     AND NOT EXISTS (
       SELECT 1 FROM aa_01_campaigns.raw_orders r
        WHERE r.campaign_id = oe.campaign_id
        LIMIT 1
     )
   GROUP BY oe.campaign_id, lower(btrim(oe.email))
  UNION
  SELECT io.campaign_id::bigint,
         lower(btrim(io.customer_email))
    FROM aa_01_campaigns.isod_orders io
   WHERE io.customer_email IS NOT NULL
     AND btrim(io.customer_email) <> ''
     AND NOT EXISTS (
       SELECT 1 FROM aa_01_campaigns.raw_orders
        WHERE campaign_id = io.campaign_id LIMIT 1
     )
     AND NOT EXISTS (
       SELECT 1 FROM aa_01_campaigns.order_entitlements
        WHERE campaign_id = io.campaign_id LIMIT 1
     )
   GROUP BY io.campaign_id, lower(btrim(io.customer_email))
  UNION
  SELECT hol.campaign_id::bigint,
         lower(btrim(ho.email))
    FROM aa_01_campaigns.historic_order_lines hol
    JOIN aa_01_campaigns.historic_orders ho ON ho.id = hol.historic_order_id
   WHERE ho.order_status = 'paid'
     AND ho.email IS NOT NULL
     AND btrim(ho.email) <> ''
   GROUP BY hol.campaign_id, lower(btrim(ho.email));

GRANT SELECT ON aa_02_crm.v_campaign_paying_emails TO authenticated;

-- 3. RPC: total paying customers.
CREATE OR REPLACE FUNCTION public.get_paying_customer_count()
RETURNS bigint
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, aa_02_crm
AS $$
  SELECT count(*)::bigint FROM aa_02_crm.v_paying_customer_emails;
$$;

REVOKE ALL ON FUNCTION public.get_paying_customer_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_paying_customer_count() TO anon, authenticated;

-- 4. RPC: per-campaign paying customer count.
CREATE OR REPLACE FUNCTION public.get_campaign_paying_customer_count(p_campaign_id bigint)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, aa_02_crm
AS $$
  SELECT count(*)::int
    FROM aa_02_crm.v_campaign_paying_emails
   WHERE campaign_id = p_campaign_id;
$$;

REVOKE ALL ON FUNCTION public.get_campaign_paying_customer_count(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_paying_customer_count(bigint) TO anon, authenticated;

-- 5. Campaign stats v3 — uses v_campaign_paying_emails for customer count.
CREATE OR REPLACE FUNCTION public.get_campaign_stats_v3()
RETURNS TABLE(
  campaign_id     bigint,
  campaign_name   text,
  total_customers integer,
  total_spend     numeric,
  total_orders    integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, aa_01_campaigns, aa_02_crm
AS $$
  WITH shopify_attribution AS (
    SELECT
      product_campaign_id::bigint AS campaign_id,
      shopify_order_id,
      line_revenue
    FROM aa_01_campaigns.v_raw_order_line_attribution
    WHERE financial_status = 'paid'
      AND product_campaign_id IS NOT NULL
  ),
  spend_rollup AS (
    SELECT campaign_id, sum(line_revenue)::numeric AS spend
    FROM shopify_attribution
    GROUP BY campaign_id
  ),
  raw_order_count AS (
    SELECT campaign_id::bigint, count(distinct id)::int AS n
    FROM aa_01_campaigns.raw_orders
    WHERE financial_status = 'paid'
    GROUP BY campaign_id
  ),
  isod_order_count AS (
    SELECT campaign_id::bigint, count(distinct id)::int AS n
    FROM aa_01_campaigns.isod_orders
    GROUP BY campaign_id
  ),
  historic_order_count AS (
    SELECT hol.campaign_id::bigint, count(distinct ho.id)::int AS n
    FROM aa_01_campaigns.historic_order_lines hol
    JOIN aa_01_campaigns.historic_orders ho ON ho.id = hol.historic_order_id
    WHERE ho.order_status = 'paid'
    GROUP BY hol.campaign_id
  ),
  customer_count AS (
    SELECT campaign_id, count(*)::int AS n
    FROM aa_02_crm.v_campaign_paying_emails
    GROUP BY campaign_id
  )
  SELECT
    c.id::bigint                                    AS campaign_id,
    c."Name"::text                                  AS campaign_name,
    coalesce(cc.n, 0)                               AS total_customers,
    coalesce(sp.spend, 0)::numeric                  AS total_spend,
    (coalesce(roc.n, 0)
     + coalesce(ioc.n, 0)
     + coalesce(hoc.n, 0))::int                     AS total_orders
  FROM aa_01_campaigns.campaigns c
  LEFT JOIN customer_count cc        ON cc.campaign_id  = c.id
  LEFT JOIN spend_rollup   sp        ON sp.campaign_id  = c.id
  LEFT JOIN raw_order_count roc      ON roc.campaign_id = c.id
  LEFT JOIN isod_order_count ioc     ON ioc.campaign_id = c.id
  LEFT JOIN historic_order_count hoc ON hoc.campaign_id = c.id
  ORDER BY c.id;
$$;

REVOKE ALL ON FUNCTION public.get_campaign_stats_v3() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_stats_v3() TO anon, authenticated;

-- 6. get_customers_list: paying-only filter by default, with an
-- escape-hatch p_include_unpaid for a future support-tools toggle.
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
  WITH raw_spend AS (
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
    LEFT JOIN raw_spend rs ON rs.email = lower(cs.email)
    WHERE (
      p_include_unpaid
      OR EXISTS (
        SELECT 1 FROM aa_02_crm.v_paying_customer_emails p
         WHERE p.email = lower(cs.email)
      )
    )
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
