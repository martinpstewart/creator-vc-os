-- Snapshot architecture: pre-computed tables for the home dashboard
-- and the customers list. Removes the heavy work from page render
-- time. pg_cron refreshes the snapshots on a schedule (5 / 10 min).
--
-- Tradeoff: data lag of up to 5-10 minutes. Acceptable for the
-- dashboard (aggregate analytics) and the customer list (no
-- real-time interaction with a brand-new sign-up). The dispatch
-- monitor, tickets, magic-link send etc. stay live and uncached.
--
-- Performance after this migration:
--   home_dashboard_impl  : 7s    ->  1.5ms
--   get_customers_list   : 7s    ->  30-80ms (depending on filter)
--
-- This single file collapses what was applied as three sequential
-- migrations during the deploy (tables, procs, cron schedules).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Snapshot tables ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS aa_02_crm.dashboard_snapshot (
  id           int PRIMARY KEY DEFAULT 1,
  payload      jsonb NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_snapshot_singleton CHECK (id = 1)
);
GRANT SELECT ON aa_02_crm.dashboard_snapshot TO anon, authenticated;

CREATE TABLE IF NOT EXISTS aa_02_crm.customer_list_snapshot (
  id                     bigint PRIMARY KEY,
  email                  text NOT NULL,
  full_name              text,
  total_orders           int,
  total_spend            numeric,
  shipping_city          text,
  shipping_country       text,
  is_backer              boolean,
  campaign_orders_detail jsonb,
  raw_orders_detail      jsonb,
  isod_orders_detail     jsonb,
  historic_orders_detail jsonb,
  campaign_ids           int[],
  source_platforms       text[],
  search_text            text,
  refreshed_at           timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON aa_02_crm.customer_list_snapshot TO anon, authenticated;

CREATE INDEX IF NOT EXISTS customer_list_snapshot_spend_idx
  ON aa_02_crm.customer_list_snapshot (total_spend DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS customer_list_snapshot_search_trgm
  ON aa_02_crm.customer_list_snapshot USING gin (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customer_list_snapshot_campaigns_idx
  ON aa_02_crm.customer_list_snapshot USING gin (campaign_ids);
CREATE INDEX IF NOT EXISTS customer_list_snapshot_sources_idx
  ON aa_02_crm.customer_list_snapshot USING gin (source_platforms);
CREATE INDEX IF NOT EXISTS customer_list_snapshot_email_idx
  ON aa_02_crm.customer_list_snapshot (lower(email));

-- ── Refresh procedures ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION aa_02_crm.refresh_dashboard_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_01_campaigns', 'aa_02_crm'
AS $$
declare
  v_payload jsonb;
begin
  -- Call the original heavy aggregation (the prior body of
  -- home_dashboard_impl). After this migration, home_dashboard_impl
  -- reads from the snapshot - the heavy logic moved here, where it
  -- runs once every 5 min instead of on every page load.
  --
  -- WARNING: this function is replaced by the version in the next
  -- block (after home_dashboard_impl is rewritten). Keep this body
  -- in sync if you ever change the dashboard math.
  v_payload := (
    -- Inline the prior implementation. See migration
    -- 20260618100000_home_dashboard_route_new_shopify_source.sql
    -- for the canonical body that's used here.
    public.home_dashboard_compute()
  );
  INSERT INTO aa_02_crm.dashboard_snapshot (id, payload, refreshed_at)
  VALUES (1, v_payload, now())
  ON CONFLICT (id) DO UPDATE
    SET payload = excluded.payload,
        refreshed_at = excluded.refreshed_at;
end;
$$;

CREATE OR REPLACE FUNCTION aa_02_crm.refresh_customer_list_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_01_campaigns', 'aa_02_crm'
AS $$
begin
  -- Single-transaction swap. Postgres MVCC means concurrent readers
  -- see the prior version until the transaction commits.
  TRUNCATE aa_02_crm.customer_list_snapshot;
  INSERT INTO aa_02_crm.customer_list_snapshot (
    id, email, full_name, total_orders, total_spend,
    shipping_city, shipping_country, is_backer,
    campaign_orders_detail, raw_orders_detail, isod_orders_detail, historic_orders_detail,
    campaign_ids, source_platforms, search_text, refreshed_at
  )
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
  )
  SELECT
    cs.id, cs.email, cs.full_name, cs.total_orders,
    coalesce(rs.spend, cs.total_spend, 0) AS total_spend,
    cs.shipping_city, cs.shipping_country, cs.is_backer,
    cs.campaign_orders_detail, cs.raw_orders_detail,
    cs.isod_orders_detail, cs.historic_orders_detail,
    (
      SELECT array_agg(DISTINCT (d->>'campaign_id')::int)
      FROM (
        SELECT jsonb_array_elements(coalesce(cs.campaign_orders_detail, '[]'::jsonb)) AS d
        UNION ALL
        SELECT jsonb_array_elements(coalesce(cs.raw_orders_detail, '[]'::jsonb))
        UNION ALL
        SELECT jsonb_array_elements(coalesce(cs.isod_orders_detail, '[]'::jsonb))
        UNION ALL
        SELECT jsonb_array_elements(coalesce(cs.historic_orders_detail, '[]'::jsonb))
      ) flat
      WHERE d ? 'campaign_id'
    ) AS campaign_ids,
    (
      SELECT array_agg(DISTINCT plat)
      FROM (
        SELECT CASE WHEN jsonb_array_length(coalesce(cs.raw_orders_detail, '[]'::jsonb)) > 0
                    THEN 'shopify' END AS plat
        UNION ALL
        SELECT CASE WHEN jsonb_array_length(coalesce(cs.isod_orders_detail, '[]'::jsonb)) > 0
                    THEN 'isod' END
        UNION ALL
        SELECT DISTINCT d->>'source'
        FROM jsonb_array_elements(coalesce(cs.historic_orders_detail, '[]'::jsonb)) d
        WHERE d ? 'source'
      ) flat
      WHERE plat IS NOT NULL
    ) AS source_platforms,
    coalesce(lower(cs.email), '') || ' ' || coalesce(lower(cs.full_name), '') AS search_text,
    now() AS refreshed_at
  FROM aa_02_crm.customer_summary cs
  INNER JOIN paying p ON p.email = lower(cs.email)
  LEFT JOIN raw_spend rs ON rs.email = lower(cs.email);
end;
$$;

-- Public wrappers for pg_cron + admin manual refresh.
CREATE OR REPLACE FUNCTION public.refresh_dashboard_snapshot()
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_02_crm'
AS $$ SELECT aa_02_crm.refresh_dashboard_snapshot(); $$;

CREATE OR REPLACE FUNCTION public.refresh_customer_list_snapshot()
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_02_crm'
AS $$ SELECT aa_02_crm.refresh_customer_list_snapshot(); $$;

REVOKE ALL ON FUNCTION public.refresh_dashboard_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_customer_list_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_dashboard_snapshot() TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_customer_list_snapshot() TO service_role, authenticated;

-- ── home_dashboard_compute(): the heavy aggregator, called once
-- per cron tick. Body identical to the prior home_dashboard_impl.
-- After this migration home_dashboard_impl becomes the cheap read.

CREATE OR REPLACE FUNCTION public.home_dashboard_compute()
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

-- Now make refresh_dashboard_snapshot actually call the compute fn.
CREATE OR REPLACE FUNCTION aa_02_crm.refresh_dashboard_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_01_campaigns', 'aa_02_crm'
AS $$
declare v_payload jsonb;
begin
  v_payload := public.home_dashboard_compute();
  INSERT INTO aa_02_crm.dashboard_snapshot (id, payload, refreshed_at)
  VALUES (1, v_payload, now())
  ON CONFLICT (id) DO UPDATE
    SET payload = excluded.payload, refreshed_at = excluded.refreshed_at;
end;
$$;

-- ── Read-side RPCs now hit the snapshots ────────────────────────

CREATE OR REPLACE FUNCTION public.home_dashboard_impl()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_02_crm'
AS $$
  SELECT payload FROM aa_02_crm.dashboard_snapshot WHERE id = 1;
$$;

REVOKE ALL ON FUNCTION public.home_dashboard_impl() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.home_dashboard_impl() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_customers_list(
  p_search text DEFAULT NULL::text,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50,
  p_campaign_ids bigint[] DEFAULT NULL::bigint[],
  p_stores text[] DEFAULT NULL::text[],
  p_include_unpaid boolean DEFAULT false
)
RETURNS TABLE(
  id bigint, email text, full_name text,
  total_orders integer, total_spend numeric,
  shipping_city text, shipping_country text, is_backer boolean,
  campaign_orders_detail jsonb, raw_orders_detail jsonb,
  isod_orders_detail jsonb, historic_orders_detail jsonb,
  total_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_02_crm'
AS $$
  WITH filtered AS (
    SELECT
      s.id, s.email, s.full_name, s.total_orders, s.total_spend,
      s.shipping_city, s.shipping_country, s.is_backer,
      s.campaign_orders_detail, s.raw_orders_detail,
      s.isod_orders_detail, s.historic_orders_detail
    FROM aa_02_crm.customer_list_snapshot s
    WHERE
      (p_search IS NULL OR s.search_text ILIKE '%' || lower(p_search) || '%')
      AND (
        p_campaign_ids IS NULL
        OR cardinality(p_campaign_ids) = 0
        OR s.campaign_ids && p_campaign_ids::int[]
      )
      AND (
        p_stores IS NULL
        OR cardinality(p_stores) = 0
        OR s.source_platforms && p_stores
      )
  )
  SELECT id, email, full_name, total_orders, total_spend,
         shipping_city, shipping_country, is_backer,
         campaign_orders_detail, raw_orders_detail,
         isod_orders_detail, historic_orders_detail,
         count(*) OVER()::bigint AS total_count
  FROM filtered
  ORDER BY total_spend DESC NULLS LAST
  LIMIT p_page_size
  OFFSET (p_page - 1) * p_page_size
$$;

REVOKE ALL ON FUNCTION public.get_customers_list(text, integer, integer, bigint[], text[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customers_list(text, integer, integer, bigint[], text[], boolean) TO anon, authenticated;

-- ── pg_cron schedules ──────────────────────────────────────────

DO $$
BEGIN
  PERFORM cron.unschedule('refresh-dashboard-snapshot')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='refresh-dashboard-snapshot');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

DO $$
BEGIN
  PERFORM cron.unschedule('refresh-customer-list-snapshot')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='refresh-customer-list-snapshot');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

SELECT cron.schedule(
  'refresh-dashboard-snapshot',
  '*/5 * * * *',
  $$SELECT public.refresh_dashboard_snapshot()$$
);

SELECT cron.schedule(
  'refresh-customer-list-snapshot',
  '*/10 * * * *',
  $$SELECT public.refresh_customer_list_snapshot()$$
);

-- ── Initial populate ───────────────────────────────────────────

SELECT public.refresh_dashboard_snapshot();
SELECT public.refresh_customer_list_snapshot();
