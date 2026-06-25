-- Repoint get_campaign_stats_v3 to the matview. The body is unchanged from
-- the prior version except for the relation name in spend_rollup. Hot path
-- for the campaigns list snapshot — the matview made it instant from ~30s.
CREATE OR REPLACE FUNCTION public.get_campaign_stats_v3()
 RETURNS TABLE(campaign_id bigint, campaign_name text, total_customers integer, total_spend numeric, total_orders integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'aa_01_campaigns', 'aa_02_crm'
AS $function$
  WITH spend_rollup AS (
    SELECT
      product_campaign_id::bigint AS campaign_id,
      sum(line_revenue)::numeric  AS spend
    FROM aa_01_campaigns.mv_raw_order_line_attribution
    WHERE financial_status = 'paid'
      AND product_campaign_id IS NOT NULL
    GROUP BY product_campaign_id
  ),
  isod_spend AS (
    SELECT
      io.campaign_id::bigint AS campaign_id,
      coalesce(sum(l.price_paid), 0)::numeric AS spend
    FROM aa_01_campaigns.isod_order_lines l
    JOIN aa_01_campaigns.isod_orders io ON io.id = l.isod_order_id
    WHERE io.campaign_id IS NOT NULL
    GROUP BY io.campaign_id
  ),
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
    FROM raw_branch GROUP BY campaign_id
  ),
  raw_emails AS (
    SELECT distinct campaign_id, email FROM raw_branch
  ),
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
    FROM aa_01_campaigns.isod_orders GROUP BY campaign_id
  ),
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
    FROM all_paying GROUP BY campaign_id
  )
  SELECT
    c.id::bigint                                    AS campaign_id,
    c."Name"::text                                  AS campaign_name,
    coalesce(cc.n, 0)                               AS total_customers,
    (coalesce(sp.spend, 0) + coalesce(isp.spend, 0))::numeric AS total_spend,
    (coalesce(roc.n, 0)
     + coalesce(ioc.n, 0)
     + coalesce(hoc.n, 0))::int                     AS total_orders
  FROM aa_01_campaigns.campaigns c
  LEFT JOIN customer_count cc        ON cc.campaign_id  = c.id
  LEFT JOIN spend_rollup   sp        ON sp.campaign_id  = c.id
  LEFT JOIN isod_spend     isp       ON isp.campaign_id = c.id
  LEFT JOIN raw_order_count roc      ON roc.campaign_id = c.id
  LEFT JOIN isod_order_count ioc     ON ioc.campaign_id = c.id
  LEFT JOIN historic_order_count hoc ON hoc.campaign_id = c.id
  ORDER BY c.id;
$function$;
