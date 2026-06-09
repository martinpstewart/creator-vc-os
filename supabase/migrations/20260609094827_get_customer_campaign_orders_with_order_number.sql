-- Customer detail "Campaigns Supported": surface a human-readable
-- order number on every row, not just ISOD.
--
-- Existing RPC returned `order_id` only — for Shopify this is the
-- numeric Shopify GID, useless in the UI. Adding `order_number`:
--   - shopify       → raw_orders.shopify_order_number (the #1234 string)
--   - entitlements  → shopify_order_id (no friendlier value on the
--                     v_crm_customer_purchases view)
--   - isod          → isod_orders.purchase_order_number (Backerkit PO)
--
-- order_id stays in the return type for traceability — UI now renders
-- order_number with order_id as a fallback when order_number is null.
--
-- DROP first because adding a column to the RETURNS TABLE is a return
-- type change; Postgres rejects that via CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.get_customer_campaign_orders(text, integer);

CREATE FUNCTION public.get_customer_campaign_orders(
  p_email text,
  p_campaign_id integer
)
RETURNS TABLE(
  product_name text,
  variant_name text,
  quantity integer,
  price_paid numeric,
  order_id text,
  order_number text,
  purchase_type text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, aa_01_campaigns, aa_02_crm
AS $$
  SELECT
    (li->>'title')::text                              AS product_name,
    NULLIF(TRIM(li->>'variant_title'), '')            AS variant_name,
    (li->>'quantity')::integer                        AS quantity,
    (li->>'price')::numeric                           AS price_paid,
    ro.shopify_order_id                               AS order_id,
    ro.shopify_order_number                           AS order_number,
    'shopify'::text                                   AS purchase_type
  FROM aa_01_campaigns.raw_orders ro,
       jsonb_array_elements(ro.payload->'line_items') AS li
  WHERE ro.campaign_id = p_campaign_id
    AND lower(TRIM(ro.email)) = lower(TRIM(p_email))
    AND ro.financial_status = 'paid'

  UNION ALL

  SELECT
    p.title_at_purchase                               AS product_name,
    NULLIF(TRIM(p.variant_title_at_purchase), '')     AS variant_name,
    p.quantity,
    p.price_paid,
    p.shopify_order_id                                AS order_id,
    p.shopify_order_id                                AS order_number,
    p.purchase_type
  FROM aa_01_campaigns.v_crm_customer_purchases p
  WHERE p.campaign_id = p_campaign_id
    AND lower(TRIM(p.email)) = lower(TRIM(p_email))
    AND NOT EXISTS (
      SELECT 1 FROM aa_01_campaigns.raw_orders
      WHERE campaign_id = p_campaign_id LIMIT 1
    )

  UNION ALL

  SELECT
    iol.sku_after_correction                          AS product_name,
    NULL::text                                        AS variant_name,
    1::integer                                        AS quantity,
    iol.price_paid                                    AS price_paid,
    io.order_id                                       AS order_id,
    io.purchase_order_number                          AS order_number,
    'isod'::text                                      AS purchase_type
  FROM aa_01_campaigns.isod_orders io
  JOIN aa_01_campaigns.isod_order_lines iol ON iol.isod_order_id = io.id
  WHERE io.campaign_id = p_campaign_id
    AND lower(TRIM(io.customer_email)) = lower(TRIM(p_email))
    AND NOT EXISTS (
      SELECT 1 FROM aa_01_campaigns.raw_orders
      WHERE campaign_id = p_campaign_id LIMIT 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM aa_01_campaigns.order_entitlements
      WHERE campaign_id = p_campaign_id LIMIT 1
    )
  ORDER BY order_number NULLS LAST, product_name
$$;

REVOKE ALL ON FUNCTION public.get_customer_campaign_orders(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_campaign_orders(text, integer) TO anon, authenticated;
