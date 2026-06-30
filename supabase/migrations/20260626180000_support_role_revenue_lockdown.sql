-- Belt-and-braces server-side lockdown of the Support role's view.
-- The frontend (sidebar / bottom nav / middleware) already keeps
-- Support inside /customers + /tickets, but every revenue-bearing RPC
-- below was previously executable by any authenticated user. A Support
-- user who opened DevTools and POSTed to PostgREST directly could pull
-- campaign revenue. These guards refuse the call at the database.

create or replace function public.can_see_revenue()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.app_user_roles
    where user_id = auth.uid()
      and role in ('admin','team')
  );
$$;
grant execute on function public.can_see_revenue() to authenticated;

-- ── home_dashboard_impl — admin only ─────────────────────────────────
-- home_dashboard wraps this with is_admin(), but the impl was exposed
-- directly. Close the side door.
create or replace function public.home_dashboard_impl()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, aa_02_crm
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  return (select payload from aa_02_crm.dashboard_snapshot where id = 1);
end;
$$;

-- ── get_campaigns_list — admin + team ────────────────────────────────
create or replace function public.get_campaigns_list()
returns table (
  campaign_id integer,
  campaign_name text,
  legacy_code text,
  total_orders integer,
  total_customers integer,
  total_revenue numeric,
  has_historic boolean,
  paying_customer_count integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, aa_02_crm
as $$
begin
  if not public.can_see_revenue() then
    raise exception 'forbidden: revenue access denied' using errcode = '42501';
  end if;
  return query
    select s.campaign_id, s.campaign_name, s.legacy_code,
           s.total_orders, s.total_customers, s.total_revenue, s.has_historic,
           s.paying_customer_count
    from aa_02_crm.campaigns_list_snapshot s
    order by s.total_revenue desc nulls last, s.campaign_name;
end;
$$;

-- ── get_campaign_stats_v3 — admin + team ─────────────────────────────
create or replace function public.get_campaign_stats_v3()
returns table (
  campaign_id bigint,
  campaign_name text,
  total_customers integer,
  total_spend numeric,
  total_orders integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, aa_01_campaigns, aa_02_crm
as $$
begin
  if not public.can_see_revenue() then
    raise exception 'forbidden: revenue access denied' using errcode = '42501';
  end if;
  return query
    with spend_rollup as (
      select product_campaign_id::bigint as campaign_id,
             sum(line_revenue)::numeric  as spend
      from aa_01_campaigns.mv_raw_order_line_attribution
      where financial_status = 'paid' and product_campaign_id is not null
      group by product_campaign_id
    ),
    isod_spend as (
      select io.campaign_id::bigint as campaign_id,
             coalesce(sum(l.price_paid),0)::numeric as spend
      from aa_01_campaigns.isod_order_lines l
      join aa_01_campaigns.isod_orders io on io.id = l.isod_order_id
      where io.campaign_id is not null
      group by io.campaign_id
    ),
    raw_branch as (
      select campaign_id::bigint as campaign_id,
             lower(btrim(email))  as email,
             id                   as order_id
      from aa_01_campaigns.raw_orders
      where financial_status = 'paid' and email is not null and btrim(email) <> ''
    ),
    raw_order_count as (select campaign_id, count(distinct order_id)::int as n from raw_branch group by campaign_id),
    raw_emails as (select distinct campaign_id, email from raw_branch),
    ent_emails as (
      select distinct oe.campaign_id::bigint as campaign_id,
                      lower(btrim(oe.email)) as email
      from aa_01_campaigns.order_entitlements oe
      where oe.email is not null and btrim(oe.email) <> ''
        and not exists (select 1 from raw_branch r where r.campaign_id = oe.campaign_id limit 1)
    ),
    isod_emails as (
      select distinct io.campaign_id::bigint as campaign_id,
                      lower(btrim(io.customer_email)) as email
      from aa_01_campaigns.isod_orders io
      where io.customer_email is not null and btrim(io.customer_email) <> ''
        and not exists (select 1 from raw_branch  r where r.campaign_id = io.campaign_id limit 1)
        and not exists (select 1 from ent_emails e where e.campaign_id = io.campaign_id limit 1)
    ),
    isod_order_count as (
      select campaign_id::bigint, count(distinct id)::int as n
      from aa_01_campaigns.isod_orders group by campaign_id
    ),
    hist_emails as (
      select distinct hol.campaign_id::bigint as campaign_id,
                      lower(btrim(ho.email))  as email
      from aa_01_campaigns.historic_order_lines hol
      join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
      where ho.order_status = 'paid' and ho.email is not null and btrim(ho.email) <> ''
    ),
    historic_order_count as (
      select hol.campaign_id::bigint, count(distinct ho.id)::int as n
      from aa_01_campaigns.historic_order_lines hol
      join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
      where ho.order_status = 'paid' group by hol.campaign_id
    ),
    all_paying as (
      select campaign_id, email from raw_emails union
      select campaign_id, email from ent_emails union
      select campaign_id, email from isod_emails union
      select campaign_id, email from hist_emails
    ),
    customer_count as (select campaign_id, count(*)::int as n from all_paying group by campaign_id)
    select c.id::bigint as campaign_id,
           c."Name"::text as campaign_name,
           coalesce(cc.n,0) as total_customers,
           (coalesce(sp.spend,0) + coalesce(isp.spend,0))::numeric as total_spend,
           (coalesce(roc.n,0) + coalesce(ioc.n,0) + coalesce(hoc.n,0))::int as total_orders
    from aa_01_campaigns.campaigns c
    left join customer_count cc on cc.campaign_id = c.id
    left join spend_rollup sp on sp.campaign_id = c.id
    left join isod_spend isp on isp.campaign_id = c.id
    left join raw_order_count roc on roc.campaign_id = c.id
    left join isod_order_count ioc on ioc.campaign_id = c.id
    left join historic_order_count hoc on hoc.campaign_id = c.id
    order by c.id;
end;
$$;

-- ── get_campaign_orders_summary — admin + team ───────────────────────
create or replace function public.get_campaign_orders_summary(
  p_campaign_id integer,
  p_product_ids integer[] default null,
  p_start_date timestamp with time zone default null,
  p_end_date timestamp with time zone default null,
  p_kinds text[] default null
)
returns table (
  total_orders bigint,
  total_revenue numeric,
  unique_backers bigint,
  total_units bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, aa_02_crm
as $$
begin
  if not public.can_see_revenue() then
    raise exception 'forbidden: revenue access denied' using errcode = '42501';
  end if;
  return query
    select count(*)::bigint,
           coalesce(sum(line_revenue),0)::numeric,
           count(distinct email) filter (where email is not null)::bigint,
           coalesce(sum(units),0)::bigint
    from aa_02_crm.campaign_orders_snapshot
    where campaign_id = p_campaign_id
      and (p_product_ids is null or cardinality(p_product_ids) = 0 or product_ids && p_product_ids)
      and (p_start_date is null or order_date >= p_start_date)
      and (p_end_date is null or order_date <  p_end_date)
      and (
        p_kinds is null or cardinality(p_kinds) = 0
        or (has_digital_lines  and 'digital'  = any(p_kinds))
        or (has_physical_lines and 'physical' = any(p_kinds))
      );
end;
$$;

-- ── get_campaign_products_v2 — admin + team ──────────────────────────
create or replace function public.get_campaign_products_v2(p_campaign_id bigint)
returns table (
  product_name text,
  variant_name text,
  source_platform text,
  units integer,
  revenue numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, aa_01_campaigns
as $$
begin
  if not public.can_see_revenue() then
    raise exception 'forbidden: revenue access denied' using errcode = '42501';
  end if;
  return query
    with live as (
      select v.product_name, v.variant_name, 'shopify'::text,
             sum(v.quantity)::int, sum(v.line_revenue)::numeric
      from aa_01_campaigns.mv_raw_order_line_attribution v
      where v.financial_status = 'paid'
        and v.product_campaign_id = p_campaign_id
        and v.product_name is not null
      group by v.product_name, v.variant_name
    ),
    historic as (
      select hol.product_name_raw, null::text, ho.source_platform,
             sum(hol.quantity)::int, sum(hol.line_revenue)::numeric
      from aa_01_campaigns.historic_order_lines hol
      join aa_01_campaigns.historic_orders ho on ho.id = hol.historic_order_id
      where ho.order_status = 'paid'
        and hol.campaign_id = p_campaign_id
        and hol.product_name_raw is not null
      group by hol.product_name_raw, ho.source_platform
    ),
    isod as (
      select l.sku_after_correction, null::text, 'isod'::text,
             count(*)::int, coalesce(sum(l.price_paid),0)::numeric
      from aa_01_campaigns.isod_order_lines l
      join aa_01_campaigns.isod_orders io on io.id = l.isod_order_id
      where io.campaign_id = p_campaign_id
        and l.sku_after_correction is not null
      group by l.sku_after_correction
    )
    select * from (
      select * from live
      union all
      select * from historic
      union all
      select * from isod
    ) all_sources
    order by 4 desc nulls last, 5 desc nulls last
    limit 100;
end;
$$;

-- ── get_campaign_backers_list — admin + team (active impl) ───────────
create or replace function public.get_campaign_backers_list(
  p_campaign_id integer,
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 100
)
returns table (
  email text,
  full_name text,
  total_spend numeric,
  order_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, aa_02_crm
as $$
begin
  if not public.can_see_revenue() then
    raise exception 'forbidden: revenue access denied' using errcode = '42501';
  end if;
  return query
    with filtered as (
      select s.email, s.full_name, s.total_spend, s.order_count
      from aa_02_crm.campaign_backers_snapshot s
      where s.campaign_id = p_campaign_id
        and (
          p_search is null
          or length(btrim(p_search)) = 0
          or s.search_text ilike '%' || lower(btrim(p_search)) || '%'
        )
    )
    select f.email, f.full_name, f.total_spend, f.order_count,
           count(*) over()::bigint as total_count
    from filtered f
    order by f.total_spend desc nulls last, f.email
    limit p_page_size
    offset (p_page - 1) * p_page_size;
end;
$$;

-- ── Deprecated / unused revenue surfaces: revoke from non-privileged ─
-- Defense in depth. Only service_role / postgres can call them now.
revoke execute on function public.get_campaign_stats_v2() from anon, authenticated;
revoke execute on function public.get_campaign_backer_list(integer, integer, integer) from anon, authenticated;
revoke execute on function public.get_campaign_backer_list_v2(integer, integer, integer) from anon, authenticated;
revoke execute on function public.get_campaign_backer_list_combined(integer, integer, integer) from anon, authenticated;
revoke execute on function public.get_campaign_historic_breakdown(bigint) from anon, authenticated;
revoke execute on function public.get_campaigns_historic_totals() from anon, authenticated;
