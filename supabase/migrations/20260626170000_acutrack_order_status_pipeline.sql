-- Plumb Acutrack's OrderStatus column through the import pipeline so
-- the customer-detail shipping-status badge reflects fulfilment state.
--
-- Source of truth: aa_01_campaigns.acutrack_received.order_status,
-- populated from the CSV's OrderStatus column on each fresh import.
--
-- Mapping (used by get_customer_campaign_orders):
--   absent from export        -> pending_shipping (label "Pending Shipping Payment")
--   row exists, status='new'  -> shipping_paid
--   row exists, status='shipped' -> dispatched
--   row exists, other status / null
--                             -> shipping_paid (covers legacy rows that
--                                were imported before we captured the
--                                status column; will be re-classified
--                                correctly on the next CSV upload).

create or replace function public.acutrack_import_append(
  p_batch text,
  p_rows  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = aa_01_campaigns, public
as $$
declare
  v_inserted int;
  v_total    int;
begin
  if coalesce(btrim(p_batch),'') = '' then
    raise exception 'acutrack_import_append: p_batch is required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'acutrack_import_append: p_rows must be a json array';
  end if;

  insert into aa_01_campaigns.acutrack_received (ponumber, date_created, order_status, loaded_batch)
  select btrim(e->>'ponumber'),
         nullif(btrim(e->>'date_created'),''),
         nullif(lower(btrim(e->>'order_status')),''),
         p_batch
  from jsonb_array_elements(p_rows) e
  where coalesce(btrim(e->>'ponumber'),'') <> '';
  get diagnostics v_inserted = row_count;

  select count(*) into v_total
  from aa_01_campaigns.acutrack_received where loaded_batch = p_batch;

  return jsonb_build_object('batch', p_batch, 'inserted', v_inserted, 'batch_total', v_total);
end;
$$;

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
  select
    (li->>'title')::text                              as product_name,
    nullif(trim(li->>'variant_title'), '')            as variant_name,
    (li->>'quantity')::integer                        as quantity,
    (li->>'price')::numeric                           as price_paid,
    ro.shopify_order_id                               as order_id,
    ro.shopify_order_number                           as order_number,
    'shopify'::text                                   as purchase_type,
    ro.financial_status                               as financial_status,
    coalesce(
      (
        select case lower(coalesce(a.order_status, ''))
          when 'shipped' then 'dispatched'
          when 'new'     then 'shipping_paid'
          else                'shipping_paid'
        end
        from aa_01_campaigns.acutrack_received a
        where btrim(a.ponumber) = btrim(ro.shopify_order_number)
        limit 1
      ),
      'pending_shipping'
    )                                                 as delivery_status
  from aa_01_campaigns.raw_orders ro,
       jsonb_array_elements(ro.payload->'line_items') as li
  where ro.campaign_id = p_campaign_id
    and lower(trim(ro.email)) = lower(trim(p_email))
    and ro.financial_status = 'paid'

  union all

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
