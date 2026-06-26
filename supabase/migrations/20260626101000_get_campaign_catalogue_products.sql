-- Thin reader RPC for the campaign-detail Orders tab's
-- ProductMultiSelect picker. Returns the canonical product list for
-- the campaign (one row per aa_01_campaigns.products row), ordered by
-- name. Used as filter input — id is what flows back into
-- get_campaign_orders.p_product_ids.
CREATE OR REPLACE FUNCTION public.get_campaign_catalogue_products(p_campaign_id int)
RETURNS TABLE(id int, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_01_campaigns'
AS $$
  SELECT p.id::int, p."Name"::text AS name
  FROM aa_01_campaigns.products p
  WHERE p.campaign_id = p_campaign_id
  ORDER BY p."Name";
$$;

GRANT EXECUTE ON FUNCTION public.get_campaign_catalogue_products(int)
  TO anon, authenticated, service_role;
