-- Home dashboard implementation — combined.customers now reads from
-- aa_02_crm.v_paying_customer_emails so the headline includes ISOD-only
-- paying customers. Headline number: 22,944 → 26,092.
--
-- Per-channel KPIs (Shopify / Gumroad / Legacy Platforms) are unchanged.
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
  v_gumroad_units       bigint;
  v_gumroad_revenue     numeric;
  v_gumroad_products    jsonb;
  v_gumroad_timeline    jsonb;
  v_legacy_kpis         jsonb;
  v_legacy_products     jsonb;
  v_legacy_timeline     jsonb;
  v_legacy_distinct_products int;
  v_combined_customers  int;
  v_combined            jsonb;
begin
  -- Shopify (live)
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

  -- Gumroad (live)
  select jsonb_build_object(
    'orders',    count(distinct v.shopify_order_id)::int,
    'customers', count(distinct lower(v.email))::int,
    'revenue',   coalesce(sum(v.line_revenue), 0)::numeric,
    'units',     coalesce(sum(v.quantity), 0)::int
  )
  into v_gumroad_kpis
  from aa_01_campaigns.v_raw_order_line_attribution v
  join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
  where v.financial_status = 'paid' and ro.source_platform = 'gumroad';

  v_gumroad_revenue := (v_gumroad_kpis->>'revenue')::numeric;
  v_gumroad_units   := (v_gumroad_kpis->>'units')::bigint;

  select jsonb_agg(t.j) into v_gumroad_products from (
    select jsonb_build_object(
      'product_name',  v.product_name,
      'units',         sum(v.quantity)::int,
      'revenue',       sum(v.line_revenue)::numeric,
      'variant_count', count(distinct v.variant_name)::int
    ) as j
    from aa_01_campaigns.v_raw_order_line_attribution v
    join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
    where v.financial_status = 'paid'
      and ro.source_platform = 'gumroad'
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
      and ro.source_platform = 'gumroad'
      and v.created_at >= date_trunc('day', now()) - interval '29 days'
    group by 1
  )
  select jsonb_agg(jsonb_build_object('date', days.d, 'count', coalesce(daily.c, 0)) order by days.d)
  into v_gumroad_timeline
  from days left join daily on daily.d = days.d;

  -- Legacy Platforms
  select jsonb_build_object(
    'orders',    count(distinct ho.id)::int,
    'customers', count(distinct lower(ho.email))::int,
    'revenue',   coalesce(sum(ho.gross_amount), 0)::numeric,
    'units',     coalesce((select sum(hol.quantity)
                            from aa_01_campaigns.historic_order_lines hol
                            join aa_01_campaigns.historic_orders ho2 on ho2.id = hol.historic_order_id
                            where ho2.order_status = 'paid'), 0)::int
  )
  into v_legacy_kpis
  from aa_01_campaigns.historic_orders ho
  where ho.order_status = 'paid';

  select count(distinct hol.product_name_raw)::int
  into v_legacy_distinct_products
  from aa_01_campaigns.historic_order_lines hol
  join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
  where ho.order_status = 'paid'
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
      and order_created_at >= date_trunc('day', now()) - interval '29 days'
    group by 1
  )
  select jsonb_agg(jsonb_build_object('date', days.d, 'count', coalesce(daily.c, 0)) order by days.d)
  into v_legacy_timeline
  from days left join daily on daily.d = days.d;

  -- COMBINED — canonical via aa_02_crm.v_paying_customer_emails.
  select count(*)::int into v_combined_customers
    from aa_02_crm.v_paying_customer_emails;

  v_combined := jsonb_build_object(
    'customers', v_combined_customers,
    'orders',    (v_shopify_kpis->>'orders')::int + (v_gumroad_kpis->>'orders')::int + (v_legacy_kpis->>'orders')::int,
    'units',     (v_shopify_kpis->>'units')::int + v_gumroad_units::int + (v_legacy_kpis->>'units')::int,
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
