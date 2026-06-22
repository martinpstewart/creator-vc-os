-- Restore the dashboard builder + break the self-referential refresh cycle.
--
-- Background: when the snapshot tables landed (migration
-- 20260618120000_snapshot_tables_and_refresh_jobs.sql), the file declared
-- public.home_dashboard_compute() as the heavy aggregator and rewired
-- aa_02_crm.refresh_dashboard_snapshot() to call it.
--
-- In practice the live DB ended up wired differently: refresh_dashboard_snapshot()
-- called home_dashboard_impl() (which at the moment of writing still held
-- the heavy logic), and a later replacement of home_dashboard_impl() with
-- a thin `SELECT payload FROM dashboard_snapshot WHERE id=1` reader left
-- refresh reading the cache and writing it straight back. No actual
-- recompute has happened since — only refreshed_at bumping on every
-- cron tick.
--
-- This migration:
--   1. Restores the aggregator as public.build_home_dashboard_payload()
--      (verbatim body from 20260618120000's home_dashboard_compute).
--   2. Rewires aa_02_crm.refresh_dashboard_snapshot() to call the BUILDER,
--      not the reader.
--   3. Leaves home_dashboard_impl() as the cache reader (the app's fast
--      read path is unchanged).
--
-- aa_02_crm.refresh_customer_list_snapshot() was checked and is NOT
-- self-referential — it TRUNCATEs and INSERTs from customer_summary
-- directly. No change needed there.
--
-- Verification: SELECT aa_02_crm.refresh_dashboard_snapshot();
--               SELECT refreshed_at, payload->'combined' FROM aa_02_crm.dashboard_snapshot;
-- combined.orders jumped from 93,089 (stale) to 124,994 (live).

CREATE OR REPLACE FUNCTION public.build_home_dashboard_payload()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'aa_01_campaigns', 'aa_02_crm'
AS $$
declare
  v_shopify_kpis        jsonb;
  v_shopify_products    jsonb;
  v_shopify_timeline    jsonb;
  v_gumroad_kpis        jsonb;
  v_gumroad_products    jsonb;
  v_gumroad_timeline    jsonb;
  v_other_kpis          jsonb;
  v_other_campaigns     jsonb;
  v_other_timeline      jsonb;
  v_other_distinct_products int;
  v_combined_customers  int;
  v_combined            jsonb;
begin
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
    where ho.order_status = 'paid' and ho.source_platform IN ('shopify', 'shopify_legacy')
  ),
  hist_units as (
    select coalesce(sum(hol.quantity), 0)::int as u
    from aa_01_campaigns.historic_order_lines hol
    join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
    where ho.order_status = 'paid' and ho.source_platform IN ('shopify', 'shopify_legacy')
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
      and ho.source_platform IN ('shopify', 'shopify_legacy')
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
      select v.product_name as name, sum(v.quantity)::int as units,
             sum(v.line_revenue)::numeric as revenue,
             count(distinct v.variant_name)::int as variant_count
      from aa_01_campaigns.v_raw_order_line_attribution v
      join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
      where v.financial_status='paid' and ro.source_platform='shopify' and v.product_id is not null
      group by v.product_name
    ),
    hist_p as (
      select hol.product_name_raw as name, sum(hol.quantity)::int as units,
             sum(hol.line_revenue)::numeric as revenue, 0 as variant_count
      from aa_01_campaigns.historic_order_lines hol
      join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
      where ho.order_status='paid' and ho.source_platform IN ('shopify','shopify_legacy')
        and hol.product_name_raw is not null
      group by hol.product_name_raw
    ),
    merged as (
      select name, sum(units)::int as units, sum(revenue)::numeric as revenue,
             max(variant_count)::int as variant_count
      from (select * from live_p union all select * from hist_p) u group by name
    )
    select jsonb_build_object('product_name', name, 'units', units, 'revenue', revenue, 'variant_count', variant_count) as j
    from merged order by units desc nulls last limit 10
  ) t;

  with days as (
    select generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day')::date as d
  ),
  daily_live as (
    select v.created_at::date as d, count(distinct v.shopify_order_id)::int as c
    from aa_01_campaigns.v_raw_order_line_attribution v
    join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
    where v.financial_status='paid' and ro.source_platform='shopify'
      and v.created_at >= date_trunc('day', now()) - interval '29 days'
    group by 1
  ),
  daily_hist as (
    select ho.order_created_at::date as d, count(*)::int as c
    from aa_01_campaigns.historic_orders ho
    where ho.order_status='paid' and ho.source_platform IN ('shopify','shopify_legacy')
      and ho.order_created_at >= date_trunc('day', now()) - interval '29 days'
    group by 1
  ),
  merged_daily as (
    select d, sum(c)::int as c from (select * from daily_live union all select * from daily_hist) u group by d
  )
  select jsonb_agg(jsonb_build_object('date', days.d, 'count', coalesce(m.c, 0)) order by days.d)
  into v_shopify_timeline
  from days left join merged_daily m on m.d = days.d;

  with live_orders as (
    select distinct ro.id as oid, lower(ro.email) as email,
           coalesce((ro.payload->>'total_price')::numeric, 0) as revenue
    from aa_01_campaigns.raw_orders ro
    where ro.financial_status='paid' and ro.source_platform='gumroad'
  ),
  hist_orders as (
    select ho.id as oid, lower(ho.email) as email,
           coalesce(ho.gross_amount, 0) as revenue
    from aa_01_campaigns.historic_orders ho
    where ho.order_status='paid' and ho.source_platform='gumroad'
  ),
  all_orders as (
    select 'live'::text as src, oid::text as oid, email, revenue from live_orders
    union all select 'hist', oid::text, email, revenue from hist_orders
  ),
  live_units as (
    select coalesce(sum(v.quantity), 0)::int as u
    from aa_01_campaigns.v_raw_order_line_attribution v
    join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
    where v.financial_status='paid' and ro.source_platform='gumroad'
  ),
  hist_units as (
    select coalesce(sum(hol.quantity), 0)::int as u
    from aa_01_campaigns.historic_order_lines hol
    join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
    where ho.order_status='paid' and ho.source_platform='gumroad'
  )
  select jsonb_build_object(
    'orders',    (select count(*)::int from all_orders),
    'customers', (select count(distinct email)::int from all_orders where email is not null and email <> ''),
    'revenue',   (select coalesce(sum(revenue), 0)::numeric from all_orders),
    'units',     ((select u from live_units) + (select u from hist_units))
  ) into v_gumroad_kpis;

  select jsonb_agg(t.j) into v_gumroad_products from (
    with live_p as (
      select v.product_name as name, sum(v.quantity)::int as units,
             sum(v.line_revenue)::numeric as revenue,
             count(distinct v.variant_name)::int as variant_count
      from aa_01_campaigns.v_raw_order_line_attribution v
      join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
      where v.financial_status='paid' and ro.source_platform='gumroad' and v.product_id is not null
      group by v.product_name
    ),
    hist_p as (
      select hol.product_name_raw as name, sum(hol.quantity)::int as units,
             sum(hol.line_revenue)::numeric as revenue, 0 as variant_count
      from aa_01_campaigns.historic_order_lines hol
      join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
      where ho.order_status='paid' and ho.source_platform='gumroad' and hol.product_name_raw is not null
      group by hol.product_name_raw
    ),
    merged as (
      select name, sum(units)::int as units, sum(revenue)::numeric as revenue,
             max(variant_count)::int as variant_count
      from (select * from live_p union all select * from hist_p) u group by name
    )
    select jsonb_build_object('product_name', name, 'units', units, 'revenue', revenue, 'variant_count', variant_count) as j
    from merged order by units desc nulls last limit 10
  ) t;

  with days as (
    select generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day')::date as d
  ),
  daily_live as (
    select v.created_at::date as d, count(distinct v.shopify_order_id)::int as c
    from aa_01_campaigns.v_raw_order_line_attribution v
    join aa_01_campaigns.raw_orders ro on ro.id = v.raw_order_id
    where v.financial_status='paid' and ro.source_platform='gumroad'
      and v.created_at >= date_trunc('day', now()) - interval '29 days'
    group by 1
  ),
  daily_hist as (
    select ho.order_created_at::date as d, count(*)::int as c
    from aa_01_campaigns.historic_orders ho
    where ho.order_status='paid' and ho.source_platform='gumroad'
      and ho.order_created_at >= date_trunc('day', now()) - interval '29 days'
    group by 1
  ),
  merged_daily as (
    select d, sum(c)::int as c from (select * from daily_live union all select * from daily_hist) u group by d
  )
  select jsonb_agg(jsonb_build_object('date', days.d, 'count', coalesce(m.c, 0)) order by days.d)
  into v_gumroad_timeline
  from days left join merged_daily m on m.d = days.d;

  with other_orders as (
    select count(distinct ho.id)::int as orders,
           count(distinct lower(ho.email))::int as customers,
           coalesce(sum(ho.gross_amount), 0)::numeric as revenue
    from aa_01_campaigns.historic_orders ho
    where ho.order_status='paid' and ho.source_platform NOT IN ('gumroad', 'shopify', 'shopify_legacy')
  ),
  other_units as (
    select coalesce(sum(hol.quantity), 0)::int as u
    from aa_01_campaigns.historic_order_lines hol
    join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
    where ho.order_status='paid' and ho.source_platform NOT IN ('gumroad', 'shopify', 'shopify_legacy')
  ),
  isod_data as (
    select count(distinct io.id)::int as orders,
           count(distinct lower(io.customer_email))::int as customers,
           coalesce((select sum(l.price_paid) from aa_01_campaigns.isod_order_lines l), 0)::numeric as revenue
    from aa_01_campaigns.isod_orders io
    where io.customer_email is not null and btrim(io.customer_email) <> ''
  ),
  all_emails as (
    select lower(ho.email) as email
    from aa_01_campaigns.historic_orders ho
    where ho.order_status='paid' and ho.source_platform NOT IN ('gumroad', 'shopify', 'shopify_legacy')
      and ho.email is not null and ho.email <> ''
    union
    select lower(io.customer_email)
    from aa_01_campaigns.isod_orders io
    where io.customer_email is not null and btrim(io.customer_email) <> ''
  )
  select jsonb_build_object(
    'orders',    (select orders from other_orders) + (select orders from isod_data),
    'customers', (select count(*)::int from all_emails),
    'revenue',   (select revenue from other_orders) + (select revenue from isod_data),
    'units',     (select u from other_units)
  )
  into v_other_kpis;

  select jsonb_agg(t.j) into v_other_campaigns from (
    with hist_by_campaign as (
      select hol.campaign_id,
             count(distinct ho.id)::int as orders,
             coalesce(sum(ho.gross_amount), 0)::numeric as revenue
      from aa_01_campaigns.historic_order_lines hol
      join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
      where ho.order_status='paid'
        and ho.source_platform NOT IN ('gumroad', 'shopify', 'shopify_legacy')
        and hol.campaign_id is not null
      group by hol.campaign_id
    ),
    isod_by_campaign as (
      select io.campaign_id,
             count(distinct io.id)::int as orders,
             coalesce(sum(iol.price_paid), 0)::numeric as revenue
      from aa_01_campaigns.isod_orders io
      left join aa_01_campaigns.isod_order_lines iol on iol.isod_order_id = io.id
      group by io.campaign_id
    ),
    merged as (
      select campaign_id, sum(orders)::int as orders, sum(revenue)::numeric as revenue
      from (select * from hist_by_campaign union all select * from isod_by_campaign) u
      group by campaign_id
    )
    select jsonb_build_object(
      'campaign_id',   m.campaign_id,
      'campaign_name', c."Name",
      'legacy_code',   c.legacy_code,
      'orders',        m.orders,
      'revenue',       m.revenue
    ) as j
    from merged m
    join aa_01_campaigns.campaigns c on c.id = m.campaign_id
    order by m.orders desc nulls last
    limit 10
  ) t;

  select count(distinct hol.product_name_raw)::int
  into v_other_distinct_products
  from aa_01_campaigns.historic_order_lines hol
  join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
  where ho.order_status='paid'
    and ho.source_platform NOT IN ('gumroad', 'shopify', 'shopify_legacy')
    and hol.product_name_raw is not null;

  with days as (
    select generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day')::date as d
  ),
  daily_other as (
    select order_created_at::date as d, count(*)::int as c
    from aa_01_campaigns.historic_orders
    where order_status='paid' and source_platform NOT IN ('gumroad', 'shopify', 'shopify_legacy')
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
    select d, sum(c)::int as c from (select * from daily_other union all select * from daily_isod) u group by d
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
                  || jsonb_build_object('products', '[]'::jsonb)
                  || jsonb_build_object('campaigns', coalesce(v_other_campaigns, '[]'::jsonb))
                  || jsonb_build_object('timeline', coalesce(v_other_timeline, '[]'::jsonb))
                  || jsonb_build_object('distinct_products', v_other_distinct_products)
  );
end $$;

REVOKE ALL ON FUNCTION public.build_home_dashboard_payload() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_home_dashboard_payload() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION aa_02_crm.refresh_dashboard_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_01_campaigns', 'aa_02_crm'
AS $$
declare v_payload jsonb;
begin
  v_payload := public.build_home_dashboard_payload();
  INSERT INTO aa_02_crm.dashboard_snapshot (id, payload, refreshed_at)
  VALUES (1, v_payload, now())
  ON CONFLICT (id) DO UPDATE
    SET payload = excluded.payload,
        refreshed_at = excluded.refreshed_at;
end;
$$;
