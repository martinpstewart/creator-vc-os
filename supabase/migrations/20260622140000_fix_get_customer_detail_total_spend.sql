-- get_customer_detail.total_spend was wrapping canonical
-- customer_summary.total_spend in a coalesce against a raw_orders
-- (live Shopify) line-item subquery. Any customer with even one 'paid'
-- raw_orders row had their full spend silently truncated to the
-- Shopify slice — e.g. quicksilver700jax@cox.net showed $139 instead of
-- $602.94. While we're rebuilding, also add has_historic_orders to
-- the return shape (column exists on customer_summary, was missing
-- from the function signature).
DROP FUNCTION IF EXISTS public.get_customer_detail(text);

CREATE FUNCTION public.get_customer_detail(p_email text)
RETURNS TABLE(
  id bigint,
  email text,
  full_name text,
  first_name text,
  last_name text,
  phone text,
  total_orders integer,
  total_spend numeric,
  total_line_items integer,
  total_quantity_purchased integer,
  has_campaign_orders boolean,
  has_raw_orders boolean,
  has_isod_orders boolean,
  has_historic_orders boolean,
  shipping_address_1 text,
  shipping_address_2 text,
  shipping_city text,
  shipping_zip text,
  shipping_country text,
  shipping_country_code text,
  campaign_orders_detail jsonb,
  raw_orders_detail jsonb,
  isod_orders_detail jsonb,
  historic_orders_detail jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','aa_01_campaigns','aa_02_crm'
AS $function$
  select
    cs.id,
    lower(cs.email)                  as email,
    cs.full_name,
    cs.first_name,
    cs.last_name,
    cs.phone,
    cs.total_orders,
    cs.total_spend,
    cs.total_line_items,
    cs.total_quantity_purchased,
    cs.has_campaign_orders,
    cs.has_raw_orders,
    cs.has_isod_orders,
    cs.has_historic_orders,
    cs.shipping_address_1,
    cs.shipping_address_2,
    cs.shipping_city,
    cs.shipping_zip,
    cs.shipping_country,
    cs.shipping_country_code,
    cs.campaign_orders_detail,
    cs.raw_orders_detail,
    cs.isod_orders_detail,
    cs.historic_orders_detail
  from aa_02_crm.customer_summary cs
  where lower(trim(cs.email)) = lower(trim(p_email))
$function$;

GRANT EXECUTE ON FUNCTION public.get_customer_detail(text) TO anon, authenticated, service_role;
