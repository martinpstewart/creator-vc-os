-- Catalogue: clone an existing product row into another campaign.
--
-- The current UI only has "+ Product" (create new). Cloning lets staff
-- reuse a product definition from another campaign without retyping
-- name / flags / notes — useful when the same merch SKU runs across
-- campaigns under a shared "core SKU" (per the New Campaign modal's
-- helper text about reused products).
--
-- Variants are NOT cloned in this v1 — products.legacy_code AND
-- variants.legacy_code are both globally UNIQUE, so a faithful clone
-- would have to rename every variant too. We keep that to a follow-up;
-- for now the user adds variants via the existing UI after cloning.
--
-- Gating: admin OR team (matches catalogue access rule).
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
  ships_separately boolean,
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

  -- Validate target campaign.
  IF NOT EXISTS (SELECT 1 FROM aa_01_campaigns.campaigns c WHERE c.id = p_target_campaign_id) THEN
    RAISE EXCEPTION 'target campaign % does not exist', p_target_campaign_id USING errcode = '22023';
  END IF;

  -- Load source row (also serves as the existence check).
  SELECT * INTO v_src FROM aa_01_campaigns.products WHERE id = p_source_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source product % does not exist', p_source_product_id USING errcode = '22023';
  END IF;

  -- Pre-flight global uniqueness check so we surface a clear 23505
  -- with the colliding code rather than a generic constraint name.
  IF EXISTS (SELECT 1 FROM aa_01_campaigns.products p WHERE p.legacy_code = v_code) THEN
    RAISE EXCEPTION 'legacy_code already exists: %', v_code USING errcode = '23505';
  END IF;

  INSERT INTO aa_01_campaigns.products (
    campaign_id, "Name", legacy_code, requires_address, ships_separately, notes
  )
  VALUES (
    p_target_campaign_id,
    v_src."Name",
    v_code,
    v_src.requires_address,
    v_src.ships_separately,
    v_src.notes
  )
  RETURNING aa_01_campaigns.products.id INTO v_new_id;

  RETURN QUERY
    SELECT p.id, p.campaign_id, p."Name" AS name, p.legacy_code,
           p.requires_address, p.ships_separately, p.notes
      FROM aa_01_campaigns.products p
     WHERE p.id = v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.clone_product_into_campaign(bigint, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clone_product_into_campaign(bigint, bigint, text) TO authenticated;
