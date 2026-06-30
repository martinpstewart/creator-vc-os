-- ISOD is a documentary, not a sales channel; its orders were placed
-- on the pre-launch Shopify checkout. Treat a 'shopify_legacy' store
-- filter as covering both 'shopify_legacy' and 'isod' tagged customers
-- so the UI can drop the ISOD chip without losing visibility into those
-- 5,730 customers.

create or replace function public.get_customers_list(
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 50,
  p_campaign_ids bigint[] default null,
  p_stores text[] default null,
  p_include_unpaid boolean default false
)
returns table (
  id bigint, email text, full_name text,
  total_orders integer, total_spend numeric,
  shipping_city text, shipping_country text, is_backer boolean,
  campaign_orders_detail jsonb, raw_orders_detail jsonb,
  isod_orders_detail jsonb, historic_orders_detail jsonb,
  total_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public, aa_02_crm
as $$
  with expanded_stores as (
    select case
      when p_stores is null then null::text[]
      when cardinality(p_stores) = 0 then array[]::text[]
      when 'shopify_legacy' = any(p_stores) then array(
        select distinct unnest(p_stores || array['isod'])
      )
      else p_stores
    end as stores
  ),
  filtered as (
    select
      s.id, s.email, s.full_name,
      s.total_orders, s.total_spend,
      s.shipping_city, s.shipping_country, s.is_backer,
      s.campaign_orders_detail, s.raw_orders_detail,
      s.isod_orders_detail, s.historic_orders_detail
    from aa_02_crm.customer_list_snapshot s
    cross join expanded_stores es
    where
      (p_search is null or s.search_text ilike '%' || lower(p_search) || '%')
      and (
        p_campaign_ids is null
        or cardinality(p_campaign_ids) = 0
        or s.campaign_ids && p_campaign_ids::int[]
      )
      and (
        es.stores is null
        or cardinality(es.stores) = 0
        or s.source_platforms && es.stores
      )
  )
  select
    id, email, full_name, total_orders, total_spend,
    shipping_city, shipping_country, is_backer,
    campaign_orders_detail, raw_orders_detail,
    isod_orders_detail, historic_orders_detail,
    count(*) over()::bigint as total_count
  from filtered
  order by total_spend desc nulls last
  limit p_page_size
  offset (p_page - 1) * p_page_size;
$$;
