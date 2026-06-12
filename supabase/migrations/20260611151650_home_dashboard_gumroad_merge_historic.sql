-- Home dashboard: merge live Gumroad webhook data with the 6 years of
-- historic Gumroad CSV imports into a single Gumroad column. The old
-- split sent historic Gumroad into the Legacy Platforms bucket, which
-- caused "Gumroad" to read as ~24 days of data instead of ~6 years.
-- Legacy Platforms now contains everything historic EXCEPT Gumroad.
--
-- Numbers after this migration:
--   Shopify         (live raw_orders only — unchanged)
--   Gumroad         (live raw_orders + historic_orders where source = 'gumroad')
--   Legacy Platforms (historic_orders where source != 'gumroad' = shopify_legacy + wix)
--
-- combined.* reads from v_paying_customer_emails so the headline
-- numbers don't move — no double-counting risk.

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
  v_legacy_kpis         jsonb;
  v_legacy_products     jsonb;
  v_legacy_timeline     jsonb;
  v_legacy_distinct_products int;
  v_combined_customers  int;
  v_combined            jsonb;
begin
  -- Shopify (live) — unchanged.
  select jsonb_build_object(
    'orders',    count(distinct v.shopify_order_id)::int,
    'customers', count(distinct lower(v.email))::int,
    'revenue',   coalesce(sum(v.line_revenue), 0)::numeric,
    'units',     coalesce(sum(v.quantity), 0)::int
  )
  into v_shopify_kpis
  from aa_01_campaigns.v_raw_order_line_attribution v
  join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
  where v.financial_status = 'paid' and ro.source_platform = 'shopify';

  select jsonb_agg(t.j) into v_shopify_products from (
    select jsonb_build_object(
      'product_name',  v.product_name,
      'units',         sum(v.quantity)::int,
      'revenue',       sum(v.line_revenue)::numeric,
      'variant_count', count(distinct v.variant_name)::int
    ) as j
    from aa_01_campaigns.v_raw_order_line_attribution v
    join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
    where v.financial_status = 'paid'
      and ro.source_platform = 'shopify'
      and v.product_id is not null
    group by v.product_name
    order by sum(v.quantity) desc nulls last
    limit 10
  ) t;

  with days as (
    select generate_series(
      date_trunc('day', now()) - interval '29 days',
      date_trunc('day', now()),
      interval '1 day'
    )::date as d
  ),
  daily as (
    select v.created_at::date as d, count(distinct v.shopify_order_id)::int as c
    from aa_01_campaigns.v_raw_order_line_attribution v
    join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
    where v.financial_status = 'paid'
      and ro.source_platform = 'shopify'
      and v.created_at >= date_trunc('day', now()) - interval '29 days'
    group by 1
  )
  select jsonb_agg(jsonb_build_object('date', days.d, 'count', coalesce(daily.c, 0)) order by days.d)
  into v_shopify_timeline
  from days left join daily on daily.d = days.d;

  -- Gumroad = live + historic union.
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

  -- Legacy Platforms = historic minus Gumroad.
  select jsonb_build_object(
    'orders',    count(distinct ho.id)::int,
    'customers', count(distinct lower(ho.email))::int,
    'revenue',   coalesce(sum(ho.gross_amount), 0)::numeric,
    'units',     coalesce((select sum(hol.quantity)
                            from aa_01_campaigns.historic_order_lines hol
                            join aa_01_campaigns.historic_orders ho2 on ho2.id = hol.historic_order_id
                            where ho2.order_status = 'paid'
                              and ho2.source_platform <> 'gumroad'), 0)::int
  )
  into v_legacy_kpis
  from aa_01_campaigns.historic_orders ho
  where ho.order_status = 'paid'
    and ho.source_platform <> 'gumroad';

  select count(distinct hol.product_name_raw)::int
  into v_legacy_distinct_products
  from aa_01_campaigns.historic_order_lines hol
  join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
  where ho.order_status = 'paid'
    and ho.source_platform <> 'gumroad'
    and hol.product_name_raw is not null;

  select jsonb_agg(t.j) into v_legacy_products from (
    select jsonb_build_object(
      'product_name', hol.product_name_raw,
      'units',        sum(hol.quantity)::int,
      'revenue',      sum(hol.line_revenue)::numeric
    ) as j
    from aa_01_campaigns.historic_order_lines hol
    join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
    where ho.order_status = 'paid'
      and ho.source_platform <> 'gumroad'
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
  daily as (
    select order_created_at::date as d, count(*)::int as c
    from aa_01_campaigns.historic_orders
    where order_status='paid'
      and source_platform <> 'gumroad'
      and order_created_at >= date_trunc('day', now()) - interval '29 days'
    group by 1
  )
  select jsonb_agg(jsonb_build_object('date', days.d, 'count', coalesce(daily.c, 0)) order by days.d)
  into v_legacy_timeline
  from days left join daily on daily.d = days.d;

  -- Combined — canonical, no change.
  select count(*)::int into v_combined_customers
    from aa_02_crm.v_paying_customer_emails;

  v_combined := jsonb_build_object(
    'customers', v_combined_customers,
    'orders',    (v_shopify_kpis->>'orders')::int + (v_gumroad_kpis->>'orders')::int + (v_legacy_kpis->>'orders')::int,
    'units',     (v_shopify_kpis->>'units')::int + (v_gumroad_kpis->>'units')::int + (v_legacy_kpis->>'units')::int,
    'revenue',   (v_shopify_kpis->>'revenue')::numeric + (v_gumroad_kpis->>'revenue')::numeric + (v_legacy_kpis->>'revenue')::numeric
  );

  return jsonb_build_object(
    'combined', v_combined,
    'shopify',  v_shopify_kpis
                  || jsonb_build_object('products', coalesce(v_shopify_products, '[]'::jsonb))
                  || jsonb_build_object('timeline', coalesce(v_shopify_timeline, '[]'::jsonb)),
    'gumroad',  v_gumroad_kpis
                  || jsonb_build_object('products', coalesce(v_gumroad_products, '[]'::jsonb))
                  || jsonb_build_object('timeline', coalesce(v_gumroad_timeline, '[]'::jsonb)),
    'shopify_legacy', v_legacy_kpis
                  || jsonb_build_object('products', coalesce(v_legacy_products, '[]'::jsonb))
                  || jsonb_build_object('timeline', coalesce(v_legacy_timeline, '[]'::jsonb))
                  || jsonb_build_object('distinct_products', v_legacy_distinct_products)
  );
end $function$;
