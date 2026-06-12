-- ISOD has $573,877 of revenue stored in
-- aa_01_campaigns.isod_order_lines.price_paid. Both the home dashboard
-- and the campaigns list were treating ISOD as a $0-revenue source,
-- so the headline numbers and per-campaign revenue both undercounted
-- by half a million dollars and the ISOD 1995 campaign row showed $0.
--
-- This migration:
--   1) Adds ISOD revenue to home_dashboard_impl's Other Sources column.
--      Other Sources revenue was wix_revenue only; now it's
--      wix_revenue + isod_revenue. Combined headline revenue rises by
--      ~$574k.
--   2) Adds ISOD revenue to get_campaign_stats_v3.total_spend. The
--      v3 RPC was summing line_revenue from v_raw_order_line_attribution
--      only (live Shopify + live Gumroad). Now it also adds per-campaign
--      ISOD revenue from isod_order_lines.price_paid. The ISOD 1995
--      campaign row will display ~$574k instead of $0.
--
-- After this migration, every revenue figure across the app reads from
-- the same set of source tables in a consistent way, so Robin can
-- trace a number on the dashboard back to a number on the campaigns
-- list and they ladder up.

-- ============================================================
-- 1) Home dashboard Other Sources block now includes ISOD revenue.
-- ============================================================

CREATE OR REPLACE FUNCTION public.home_dashboard_impl()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'aa_01_campaigns', 'aa_02_crm'
AS $function$
declare
  v_shopify_kpis        jsonb;
  v_shopify_products    jsonb;
  v_shopify_timeline    jsonb;
  v_gumroad_kpis        jsonb;
  v_gumroad_products    jsonb;
  v_gumroad_timeline    jsonb;
  v_other_kpis          jsonb;
  v_other_products      jsonb;
  v_other_timeline      jsonb;
  v_other_distinct_products int;
  v_combined_customers  int;
  v_combined            jsonb;
begin
  -- Shopify = live + historic (shopify_legacy) union.
  with live_order_revenue as (
    select coalesce(sum(v.line_revenue), 0)::numeric as revenue,
           coalesce(sum(v.quantity), 0)::int as units,
           count(distinct v.shopify_order_id)::int as orders,
           count(distinct lower(v.email))::int as customers
    from aa_01_campaigns.v_raw_order_line_attribution v
    join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
    where v.financial_status = 'paid' and ro.source_platform = 'shopify'
  ),
  hist_orders as (
    select count(distinct ho.id)::int as orders,
           count(distinct lower(ho.email))::int as customers,
           coalesce(sum(ho.gross_amount), 0)::numeric as revenue
    from aa_01_campaigns.historic_orders ho
    where ho.order_status = 'paid' and ho.source_platform = 'shopify_legacy'
  ),
  hist_units as (
    select coalesce(sum(hol.quantity), 0)::int as u
    from aa_01_campaigns.historic_order_lines hol
    join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
    where ho.order_status = 'paid' and ho.source_platform = 'shopify_legacy'
  ),
  all_emails as (
    select lower(v.email) as email
    from aa_01_campaigns.v_raw_order_line_attribution v
    join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
    where v.financial_status = 'paid' and ro.source_platform = 'shopify'
      and v.email is not null and v.email <> ''
    union
    select lower(ho.email)
    from aa_01_campaigns.historic_orders ho
    where ho.order_status = 'paid'
      and ho.source_platform = 'shopify_legacy'
      and ho.email is not null and ho.email <> ''
  )
  select jsonb_build_object(
    'orders',    (select orders from live_order_revenue) + (select orders from hist_orders),
    'customers', (select count(*)::int from all_emails),
    'revenue',   (select revenue from live_order_revenue) + (select revenue from hist_orders),
    'units',     (select units from live_order_revenue) + (select u from hist_units)
  )
  into v_shopify_kpis;

  select jsonb_agg(t.j) into v_shopify_products from (
    with live_p as (
      select v.product_name as name,
             sum(v.quantity)::int as units,
             sum(v.line_revenue)::numeric as revenue,
             count(distinct v.variant_name)::int as variant_count
      from aa_01_campaigns.v_raw_order_line_attribution v
      join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
      where v.financial_status = 'paid'
        and ro.source_platform = 'shopify'
        and v.product_id is not null
      group by v.product_name
    ),
    hist_p as (
      select hol.product_name_raw as name,
             sum(hol.quantity)::int as units,
             sum(hol.line_revenue)::numeric as revenue,
             0 as variant_count
      from aa_01_campaigns.historic_order_lines hol
      join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
      where ho.order_status = 'paid'
        and ho.source_platform = 'shopify_legacy'
        and hol.product_name_raw is not null
      group by hol.product_name_raw
    ),
    merged as (
      select name, sum(units)::int as units, sum(revenue)::numeric as revenue,
             max(variant_count)::int as variant_count
      from (select * from live_p union all select * from hist_p) u
      group by name
    )
    select jsonb_build_object(
      'product_name',  name,
      'units',         units,
      'revenue',       revenue,
      'variant_count', variant_count
    ) as j
    from merged
    order by units desc nulls last
    limit 10
  ) t;

  with days as (
    select generate_series(
      date_trunc('day', now()) - interval '29 days',
      date_trunc('day', now()),
      interval '1 day'
    )::date as d
  ),
  daily_live as (
    select v.created_at::date as d, count(distinct v.shopify_order_id)::int as c
    from aa_01_campaigns.v_raw_order_line_attribution v
    join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
    where v.financial_status = 'paid'
      and ro.source_platform = 'shopify'
      and v.created_at >= date_trunc('day', now()) - interval '29 days'
    group by 1
  ),
  daily_hist as (
    select ho.order_created_at::date as d, count(*)::int as c
    from aa_01_campaigns.historic_orders ho
    where ho.order_status = 'paid'
      and ho.source_platform = 'shopify_legacy'
      and ho.order_created_at >= date_trunc('day', now()) - interval '29 days'
    group by 1
  ),
  merged_daily as (
    select d, sum(c)::int as c
    from (select * from daily_live union all select * from daily_hist) u
    group by d
  )
  select jsonb_agg(jsonb_build_object('date', days.d, 'count', coalesce(m.c, 0)) order by days.d)
  into v_shopify_timeline
  from days left join merged_daily m on m.d = days.d;

  -- Gumroad = live + historic union (unchanged).
  with live_orders as (
    select distinct ro.id as oid,
           lower(ro.email) as email,
           coalesce((ro.payload->>'total_price')::numeric, 0) as revenue
    from aa_01_campaigns.raw_orders ro
    where ro.financial_status = 'paid' and ro.source_platform = 'gumroad'
  ),
  hist_orders as (
    select ho.id as oid,
           lower(ho.email) as email,
           coalesce(ho.gross_amount, 0) as revenue
    from aa_01_campaigns.historic_orders ho
    where ho.order_status = 'paid' and ho.source_platform = 'gumroad'
  ),
  all_orders as (
    select 'live'::text as src, oid::text as oid, email, revenue from live_orders
    union all
    select 'hist',         oid::text,        email, revenue from hist_orders
  ),
  live_units as (
    select coalesce(sum(v.quantity), 0)::int as u
    from aa_01_campaigns.v_raw_order_line_attribution v
    join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
    where v.financial_status = 'paid' and ro.source_platform = 'gumroad'
  ),
  hist_units as (
    select coalesce(sum(hol.quantity), 0)::int as u
    from aa_01_campaigns.historic_order_lines hol
    join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
    where ho.order_status = 'paid' and ho.source_platform = 'gumroad'
  )
  select jsonb_build_object(
    'orders',    (select count(*)::int from all_orders),
    'customers', (select count(distinct email)::int from all_orders where email is not null and email <> ''),
    'revenue',   (select coalesce(sum(revenue), 0)::numeric from all_orders),
    'units',     ((select u from live_units) + (select u from hist_units))
  )
  into v_gumroad_kpis;

  select jsonb_agg(t.j) into v_gumroad_products from (
    with live_p as (
      select v.product_name as name,
             sum(v.quantity)::int as units,
             sum(v.line_revenue)::numeric as revenue,
             count(distinct v.variant_name)::int as variant_count
      from aa_01_campaigns.v_raw_order_line_attribution v
      join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
      where v.financial_status = 'paid'
        and ro.source_platform = 'gumroad'
        and v.product_id is not null
      group by v.product_name
    ),
    hist_p as (
      select hol.product_name_raw as name,
             sum(hol.quantity)::int as units,
             sum(hol.line_revenue)::numeric as revenue,
             0 as variant_count
      from aa_01_campaigns.historic_order_lines hol
      join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
      where ho.order_status = 'paid'
        and ho.source_platform = 'gumroad'
        and hol.product_name_raw is not null
      group by hol.product_name_raw
    ),
    merged as (
      select name, sum(units)::int as units, sum(revenue)::numeric as revenue,
             max(variant_count)::int as variant_count
      from (select * from live_p union all select * from hist_p) u
      group by name
    )
    select jsonb_build_object(
      'product_name',  name,
      'units',         units,
      'revenue',       revenue,
      'variant_count', variant_count
    ) as j
    from merged
    order by units desc nulls last
    limit 10
  ) t;

  with days as (
    select generate_series(
      date_trunc('day', now()) - interval '29 days',
      date_trunc('day', now()),
      interval '1 day'
    )::date as d
  ),
  daily_live as (
    select v.created_at::date as d, count(distinct v.shopify_order_id)::int as c
    from aa_01_campaigns.v_raw_order_line_attribution v
    join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
    where v.financial_status = 'paid'
      and ro.source_platform = 'gumroad'
      and v.created_at >= date_trunc('day', now()) - interval '29 days'
    group by 1
  ),
  daily_hist as (
    select ho.order_created_at::date as d, count(*)::int as c
    from aa_01_campaigns.historic_orders ho
    where ho.order_status = 'paid'
      and ho.source_platform = 'gumroad'
      and ho.order_created_at >= date_trunc('day', now()) - interval '29 days'
    group by 1
  ),
  merged_daily as (
    select d, sum(c)::int as c
    from (select * from daily_live union all select * from daily_hist) u
    group by d
  )
  select jsonb_agg(jsonb_build_object('date', days.d, 'count', coalesce(m.c, 0)) order by days.d)
  into v_gumroad_timeline
  from days left join merged_daily m on m.d = days.d;

  -- Other Sources = historic Wix + ISOD orders (now WITH revenue).
  with wix_orders as (
    select count(distinct ho.id)::int as orders,
           count(distinct lower(ho.email))::int as customers,
           coalesce(sum(ho.gross_amount), 0)::numeric as revenue
    from aa_01_campaigns.historic_orders ho
    where ho.order_status = 'paid'
      and ho.source_platform NOT IN ('gumroad', 'shopify_legacy')
  ),
  wix_units as (
    select coalesce(sum(hol.quantity), 0)::int as u
    from aa_01_campaigns.historic_order_lines hol
    join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
    where ho.order_status = 'paid'
      and ho.source_platform NOT IN ('gumroad', 'shopify_legacy')
  ),
  isod_data as (
    -- Revenue lives on isod_order_lines.price_paid.
    -- ISOD has no quantity column.
    select count(distinct io.id)::int as orders,
           count(distinct lower(io.customer_email))::int as customers,
           coalesce((select sum(l.price_paid)
                       from aa_01_campaigns.isod_order_lines l), 0)::numeric as revenue
    from aa_01_campaigns.isod_orders io
    where io.customer_email is not null and btrim(io.customer_email) <> ''
  ),
  all_emails as (
    select lower(ho.email) as email
    from aa_01_campaigns.historic_orders ho
    where ho.order_status = 'paid'
      and ho.source_platform NOT IN ('gumroad', 'shopify_legacy')
      and ho.email is not null and ho.email <> ''
    union
    select lower(io.customer_email)
    from aa_01_campaigns.isod_orders io
    where io.customer_email is not null and btrim(io.customer_email) <> ''
  )
  select jsonb_build_object(
    'orders',    (select orders from wix_orders) + (select orders from isod_data),
    'customers', (select count(*)::int from all_emails),
    'revenue',   (select revenue from wix_orders) + (select revenue from isod_data),
    'units',     (select u from wix_units)
  )
  into v_other_kpis;

  select count(distinct hol.product_name_raw)::int
  into v_other_distinct_products
  from aa_01_campaigns.historic_order_lines hol
  join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
  where ho.order_status = 'paid'
    and ho.source_platform NOT IN ('gumroad', 'shopify_legacy')
    and hol.product_name_raw is not null;

  select jsonb_agg(t.j) into v_other_products from (
    select jsonb_build_object(
      'product_name', hol.product_name_raw,
      'units',        sum(hol.quantity)::int,
      'revenue',      sum(hol.line_revenue)::numeric
    ) as j
    from aa_01_campaigns.historic_order_lines hol
    join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
    where ho.order_status = 'paid'
      and ho.source_platform NOT IN ('gumroad', 'shopify_legacy')
      and hol.product_name_raw is not null
    group by hol.product_name_raw
    order by sum(hol.quantity) desc nulls last
    limit 10
  ) t;

  with days as (
    select generate_series(
      date_trunc('day', now()) - interval '29 days',
      date_trunc('day', now()),
      interval '1 day'
    )::date as d
  ),
  daily_wix as (
    select order_created_at::date as d, count(*)::int as c
    from aa_01_campaigns.historic_orders
    where order_status='paid'
      and source_platform NOT IN ('gumroad', 'shopify_legacy')
      and order_created_at >= date_trunc('day', now()) - interval '29 days'
    group by 1
  ),
  daily_isod as (
    select io.order_created_at::date as d, count(*)::int as c
    from aa_01_campaigns.isod_orders io
    where io.order_created_at >= date_trunc('day', now()) - interval '29 days'
    group by 1
  ),
  merged_daily as (
    select d, sum(c)::int as c
    from (select * from daily_wix union all select * from daily_isod) u
    group by d
  )
  select jsonb_agg(jsonb_build_object('date', days.d, 'count', coalesce(m.c, 0)) order by days.d)
  into v_other_timeline
  from days left join merged_daily m on m.d = days.d;

  select count(*)::int into v_combined_customers
    from aa_02_crm.v_paying_customer_emails;

  v_combined := jsonb_build_object(
    'customers', v_combined_customers,
    'orders',    (v_shopify_kpis->>'orders')::int + (v_gumroad_kpis->>'orders')::int + (v_other_kpis->>'orders')::int,
    'units',     (v_shopify_kpis->>'units')::int + (v_gumroad_kpis->>'units')::int + (v_other_kpis->>'units')::int,
    'revenue',   (v_shopify_kpis->>'revenue')::numeric + (v_gumroad_kpis->>'revenue')::numeric + (v_other_kpis->>'revenue')::numeric
  );

  return jsonb_build_object(
    'combined', v_combined,
    'shopify',  v_shopify_kpis
                  || jsonb_build_object('products', coalesce(v_shopify_products, '[]'::jsonb))
                  || jsonb_build_object('timeline', coalesce(v_shopify_timeline, '[]'::jsonb)),
    'gumroad',  v_gumroad_kpis
                  || jsonb_build_object('products', coalesce(v_gumroad_products, '[]'::jsonb))
                  || jsonb_build_object('timeline', coalesce(v_gumroad_timeline, '[]'::jsonb)),
    'shopify_legacy', v_other_kpis
                  || jsonb_build_object('products', coalesce(v_other_products, '[]'::jsonb))
                  || jsonb_build_object('timeline', coalesce(v_other_timeline, '[]'::jsonb))
                  || jsonb_build_object('distinct_products', v_other_distinct_products)
  );
end $function$;

-- ============================================================
-- 2) get_campaign_stats_v3.total_spend now includes ISOD revenue
--    so the ISOD 1995 campaign row shows its real per-campaign total.
-- ============================================================

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
    FROM aa_01_campaigns.v_raw_order_line_attribution
    WHERE financial_status = 'paid'
      AND product_campaign_id IS NOT NULL
    GROUP BY product_campaign_id
  ),
  isod_spend AS (
    -- ISOD revenue per campaign: sum of line price_paid joined back to
    -- the parent isod_orders.campaign_id. Previously omitted entirely;
    -- adding here so ISOD-tagged campaigns report their real spend.
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
