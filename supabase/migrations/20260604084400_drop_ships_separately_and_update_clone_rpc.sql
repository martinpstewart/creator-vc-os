-- Remove the ships_separately column from products. It was meant as a
-- fulfilment hint ("ships in its own parcel separate from other items"),
-- but no code path consumed it beyond rendering a "Separate" badge and
-- every row in the live data had it set to false (0/32). Removing the
-- column simplifies the product form and prevents future confusion
-- with the unrelated "bundle item" concept.
--
-- No data is lost (every value was false). If a bundles feature is
-- introduced later, it'll live in dedicated bundles + bundle_items
-- tables rather than overloading this flag.

-- 1. Drop the clone RPC first — it references the column in its
-- INSERT, RETURNING, and TABLE return type. Recreated below without
-- the column.
DROP FUNCTION IF EXISTS public.clone_product_into_campaign(bigint, bigint, text);

-- 2. Drop the column.
ALTER TABLE aa_01_campaigns.products DROP COLUMN ships_separately;

-- 3. Recreate clone_product_into_campaign without ships_separately.
-- Same gating + uniqueness behaviour as before; just a smaller surface.
CREATE OR REPLACE FUNCTION public.clone_product_into_campaign(
  p_source_product_id bigint,
  p_target_campaign_id bigint,
  p_new_legacy_code   text
)
RETURNS TABLE(
  id bigint,
  campaign_id bigint,
  name text,
  legacy_code text,
  requires_address boolean,
  notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, aa_01_campaigns
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text;
  v_code   text := nullif(btrim(p_new_legacy_code), '');
  v_src    aa_01_campaigns.products%ROWTYPE;
  v_new_id bigint;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  SELECT r.role INTO v_role FROM public.app_user_roles r WHERE r.user_id = v_caller;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'team') THEN
    RAISE EXCEPTION 'forbidden: admin or team only' USING errcode = '42501';
  END IF;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'new legacy_code is required' USING errcode = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM aa_01_campaigns.campaigns c WHERE c.id = p_target_campaign_id) THEN
    RAISE EXCEPTION 'target campaign % does not exist', p_target_campaign_id USING errcode = '22023';
  END IF;

  SELECT * INTO v_src FROM aa_01_campaigns.products WHERE id = p_source_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source product % does not exist', p_source_product_id USING errcode = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM aa_01_campaigns.products p WHERE p.legacy_code = v_code) THEN
    RAISE EXCEPTION 'legacy_code already exists: %', v_code USING errcode = '23505';
  END IF;

  INSERT INTO aa_01_campaigns.products (
    campaign_id, "Name", legacy_code, requires_address, notes
  )
  VALUES (
    p_target_campaign_id,
    v_src."Name",
    v_code,
    v_src.requires_address,
    v_src.notes
  )
  RETURNING aa_01_campaigns.products.id INTO v_new_id;

  RETURN QUERY
    SELECT p.id, p.campaign_id, p."Name" AS name, p.legacy_code,
           p.requires_address, p.notes
      FROM aa_01_campaigns.products p
     WHERE p.id = v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.clone_product_into_campaign(bigint, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clone_product_into_campaign(bigint, bigint, text) TO authenticated;
