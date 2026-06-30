-- Add payment + delivery status to the per-order-line RPC so the
-- customer detail page can render an order-level header above the
-- line items (Order # | Payment | Delivery).
--
-- Delivery status (raw_orders branch):
--   dispatched      = acutrack_received row exists with date_shipped
--                     or tracking_no populated
--   shipping_paid   = a successful payhere_payments row for this order
--                     number but no Acutrack dispatch yet
--   pending_shipping= neither
--
-- ISOD and historic branches are completed legacy fulfilment — label
-- them 'dispatched' so the UI doesn't render a misleading status.

drop function if exists public.get_customer_campaign_orders(text, integer);

create or replace function public.get_customer_campaign_orders(
  p_email       text,
  p_campaign_id integer
)
returns table (
  product_name     text,
  variant_name     text,
  quantity         integer,
  price_paid       numeric,
  order_id         text,
  order_number     text,
  purchase_type    text,
  financial_status text,
  delivery_status  text
)
language sql
security definer
set search_path = pg_catalog, public, aa_01_campaigns, aa_02_crm
as $$
  -- Shopify live (raw_orders)
  select
    (li->>'title')::text                              as product_name,
    nullif(trim(li->>'variant_title'), '')            as variant_name,
    (li->>'quantity')::integer                        as quantity,
    (li->>'price')::numeric                           as price_paid,
    ro.shopify_order_id                               as order_id,
    ro.shopify_order_number                           as order_number,
    'shopify'::text                                   as purchase_type,
    ro.financial_status                               as financial_status,
    case
      when exists (
        select 1 from aa_01_campaigns.acutrack_received a
        where btrim(a.ponumber) = btrim(ro.shopify_order_number)
          and (a.date_shipped is not null or a.tracking_no is not null)
      ) then 'dispatched'
      when exists (
        select 1 from aa_01_campaigns.payhere_payments pp
        where pp.success = true
          and btrim(pp.order_id) = btrim(ro.shopify_order_number)
      ) then 'shipping_paid'
      else 'pending_shipping'
    end                                               as delivery_status
  from aa_01_campaigns.raw_orders ro,
       jsonb_array_elements(ro.payload->'line_items') as li
  where ro.campaign_id = p_campaign_id
    and lower(trim(ro.email)) = lower(trim(p_email))
    and ro.financial_status = 'paid'

  union all

  -- Shopify-fallback path (older orders represented via v_crm_customer_purchases)
  select
    p.title_at_purchase                               as product_name,
    nullif(trim(p.variant_title_at_purchase), '')     as variant_name,
    p.quantity,
    p.price_paid,
    p.shopify_order_id                                as order_id,
    p.shopify_order_id                                as order_number,
    p.purchase_type,
    'paid'::text                                      as financial_status,
    'dispatched'::text                                as delivery_status
  from aa_01_campaigns.v_crm_customer_purchases p
  where p.campaign_id = p_campaign_id
    and lower(trim(p.email)) = lower(trim(p_email))
    and not exists (
      select 1 from aa_01_campaigns.raw_orders
      where campaign_id = p_campaign_id limit 1
    )

  union all

  -- ISOD branch (legacy fulfilled)
  select
    iol.sku_after_correction                          as product_name,
    null::text                                        as variant_name,
    1::integer                                        as quantity,
    iol.price_paid                                    as price_paid,
    io.order_id                                       as order_id,
    io.purchase_order_number                          as order_number,
    'isod'::text                                      as purchase_type,
    'paid'::text                                      as financial_status,
    'dispatched'::text                                as delivery_status
  from aa_01_campaigns.isod_orders io
  join aa_01_campaigns.isod_order_lines iol on iol.isod_order_id = io.id
  where io.campaign_id = p_campaign_id
    and lower(trim(io.customer_email)) = lower(trim(p_email))
    and not exists (
      select 1 from aa_01_campaigns.raw_orders
      where campaign_id = p_campaign_id limit 1
    )
    and not exists (
      select 1 from aa_01_campaigns.order_entitlements
      where campaign_id = p_campaign_id limit 1
    )

  union all

  -- Historic platforms (wix / gumroad / shopify_legacy / indiegogo / kickstarter)
  select
    hol.product_name_raw                              as product_name,
    null::text                                        as variant_name,
    coalesce(hol.quantity, 1)                         as quantity,
    coalesce(hol.line_revenue, 0)::numeric            as price_paid,
    ho.source_order_id                                as order_id,
    ho.source_order_id                                as order_number,
    ho.source_platform                                as purchase_type,
    'paid'::text                                      as financial_status,
    'dispatched'::text                                as delivery_status
  from aa_01_campaigns.historic_orders ho
  join aa_01_campaigns.historic_order_lines hol on hol.historic_order_id = ho.id
  where hol.campaign_id = p_campaign_id
    and ho.order_status = 'paid'
    and lower(trim(ho.email)) = lower(trim(p_email))

  order by order_number nulls last, product_name
$$;

grant execute on function public.get_customer_campaign_orders(text, integer) to authenticated, anon, service_role;
