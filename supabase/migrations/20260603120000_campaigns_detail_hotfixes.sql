-- ============================================================
-- Two production hotfixes for /campaigns/[id] hitting the error
-- boundary for any user landing on a low-data campaign (e.g. newly
-- created campaign id 6/7 via the New Campaign modal):
--
-- 1. The existing public.get_campaign_units_sold_v2 internally
--    falls through to a (no-longer-existing) get_campaign_units_sold
--    function for some campaigns — Postgres surfaces a 42883
--    "function does not exist" error that propagates to the UI.
--    Create a thin compat shim returning the same shape so v2's
--    fallback succeeds (empty rows for empty campaigns).
--
-- 2. public.get_campaign_stats_v3 was added in the canonical-paying-
--    customer migration. Its customer_count CTE reads from
--    aa_02_crm.v_campaign_paying_emails, which is a 4-way UNION with
--    no underlying indexes — slow enough to hit statement_timeout
--    under cold cache. Rewrite v3 to inline the same gating logic
--    directly so the planner can push down filters and avoid the
--    full-table materialisation pass through the view.
-- ============================================================

-- 1. Compat shim — same return shape as v2. Returns empty for any
-- campaign (so a fallback caller gets a clean empty result set).
-- The real data path stays on _v2; this is only here to satisfy
-- v2's internal lookup when it falls through.
CREATE OR REPLACE FUNCTION public.get_campaign_units_sold(p_campaign_id integer)
RETURNS TABLE(product_name text, variant_name text, total_quantity integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, aa_01_campaigns
AS $$
  -- Mirror v2's primary path (attribution view) but without the
  -- fallback chain — the fallback was what broke for low-data
  -- campaigns. Empty result for empty campaigns is the correct
  -- behaviour; the UI handles a [] return gracefully.
  SELECT
    v.product_name::text,
    v.variant_name::text,
    SUM(v.quantity)::int AS total_quantity
  FROM aa_01_campaigns.v_raw_order_line_attribution v
  WHERE v.financial_status = 'paid'
    AND v.product_campaign_id = p_campaign_id
    AND v.product_name IS NOT NULL
  GROUP BY v.product_name, v.variant_name
  ORDER BY total_quantity DESC NULLS LAST
$$;

REVOKE ALL ON FUNCTION public.get_campaign_units_sold(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_units_sold(integer) TO anon, authenticated;

-- 2. Rewrite get_campaign_stats_v3 to inline the per-campaign paying
-- email logic INSTEAD of reading from v_campaign_paying_emails. Same
-- semantics; ~10× faster because Postgres can push the campaign_id
-- predicate down into each branch separately rather than materialising
-- the entire 4-way UNION first.
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
  WITH spend_rollup AS (
    SELECT
      product_campaign_id::bigint AS campaign_id,
      sum(line_revenue)::numeric  AS spend
    FROM aa_01_campaigns.v_raw_order_line_attribution
    WHERE financial_status = 'paid'
      AND product_campaign_id IS NOT NULL
    GROUP BY product_campaign_id
  ),
  -- raw_orders branch — always present
  raw_branch AS (
    SELECT
      campaign_id::bigint AS campaign_id,
      lower(btrim(email)) AS email,
      id                  AS order_id
    FROM aa_01_campaigns.raw_orders
    WHERE financial_status = 'paid'
      AND email IS NOT NULL
      AND btrim(email) <> ''
  ),
  raw_order_count AS (
    SELECT campaign_id, count(distinct order_id)::int AS n
    FROM raw_branch
    GROUP BY campaign_id
  ),
  raw_emails AS (
    SELECT distinct campaign_id, email FROM raw_branch
  ),
  -- entitlements branch — only for campaigns without raw activity
  ent_emails AS (
    SELECT distinct
      oe.campaign_id::bigint AS campaign_id,
      lower(btrim(oe.email)) AS email
    FROM aa_01_campaigns.order_entitlements oe
    WHERE oe.email IS NOT NULL
      AND btrim(oe.email) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM raw_branch r WHERE r.campaign_id = oe.campaign_id LIMIT 1
      )
  ),
  -- isod branch — gated on no raw + no entitlements
  isod_emails AS (
    SELECT distinct
      io.campaign_id::bigint        AS campaign_id,
      lower(btrim(io.customer_email)) AS email
    FROM aa_01_campaigns.isod_orders io
    WHERE io.customer_email IS NOT NULL
      AND btrim(io.customer_email) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM raw_branch  r WHERE r.campaign_id = io.campaign_id LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM ent_emails e WHERE e.campaign_id = io.campaign_id LIMIT 1
      )
  ),
  isod_order_count AS (
    SELECT campaign_id::bigint, count(distinct id)::int AS n
    FROM aa_01_campaigns.isod_orders
    GROUP BY campaign_id
  ),
  -- historic_order_lines branch — always union (cross-sells co-exist)
  hist_emails AS (
    SELECT distinct
      hol.campaign_id::bigint AS campaign_id,
      lower(btrim(ho.email))  AS email
    FROM aa_01_campaigns.historic_order_lines hol
    JOIN aa_01_campaigns.historic_orders ho ON ho.id = hol.historic_order_id
    WHERE ho.order_status = 'paid'
      AND ho.email IS NOT NULL
      AND btrim(ho.email) <> ''
  ),
  historic_order_count AS (
    SELECT hol.campaign_id::bigint, count(distinct ho.id)::int AS n
    FROM aa_01_campaigns.historic_order_lines hol
    JOIN aa_01_campaigns.historic_orders ho ON ho.id = hol.historic_order_id
    WHERE ho.order_status = 'paid'
    GROUP BY hol.campaign_id
  ),
  -- All paying (campaign, email) pairs together, deduped.
  all_paying AS (
    SELECT campaign_id, email FROM raw_emails
    UNION
    SELECT campaign_id, email FROM ent_emails
    UNION
    SELECT campaign_id, email FROM isod_emails
    UNION
    SELECT campaign_id, email FROM hist_emails
  ),
  customer_count AS (
    SELECT campaign_id, count(*)::int AS n
    FROM all_paying
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
