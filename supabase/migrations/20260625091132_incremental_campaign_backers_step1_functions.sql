-- Step 1 of the A2 incremental campaign_backers_snapshot work.
-- Defines the scoped builder (delete-then-recompute for a set of
-- emails), the watermark-driven driver, and the public RPC wrapper +
-- grants. Schema and row shape of campaign_backers_snapshot are
-- unchanged — this only changes how rows get there.

-- ── Scoped builder: recompute backer rows for a set of (normalised) emails ──
-- delete-then-recompute. Identical aggregation + per-campaign source gates to
-- the full refresh_campaign_backers_snapshot(); only difference is the email
-- filter and joining aa_02_crm.customers directly for full_name (same value as
-- the customer_summary view, without the view's JSONB overhead).
CREATE OR REPLACE FUNCTION aa_02_crm.refresh_campaign_backers_for_emails(p_emails text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','aa_01_campaigns','aa_02_crm'
AS $function$
BEGIN
  IF p_emails IS NULL OR array_length(p_emails, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Clear existing rows for these emails; recompute replaces them. An email
  -- that no longer qualifies anywhere simply gets no reinsert.
  DELETE FROM aa_02_crm.campaign_backers_snapshot WHERE email = ANY(p_emails);

  INSERT INTO aa_02_crm.campaign_backers_snapshot (
    campaign_id, email, full_name, total_spend, order_count, search_text, refreshed_at
  )
  WITH backer_spend AS (
    -- raw_orders: PAID Shopify line revenue per (campaign, email)
    SELECT ro.campaign_id, lower(btrim(ro.email)) AS email,
           SUM((li->>'price')::numeric * (li->>'quantity')::integer) AS spend,
           COUNT(DISTINCT ro.id)::bigint AS orders
    FROM aa_01_campaigns.raw_orders ro
    CROSS JOIN LATERAL jsonb_array_elements(ro.payload->'line_items') AS li
    WHERE ro.financial_status = 'paid'
      AND ro.email IS NOT NULL AND ro.email <> ''
      AND lower(btrim(ro.email)) = ANY(p_emails)
    GROUP BY ro.campaign_id, lower(btrim(ro.email))

    UNION ALL

    -- order_entitlements (cross-sell) — only when raw_orders has none for that campaign.
    SELECT oe.campaign_id, lower(btrim(oe.email)) AS email,
           SUM(oe.price_paid) AS spend,
           COUNT(DISTINCT oe.shopify_order_id)::bigint AS orders
    FROM aa_01_campaigns.order_entitlements oe
    WHERE oe.email IS NOT NULL AND oe.email <> ''
      AND lower(btrim(oe.email)) = ANY(p_emails)
      AND NOT EXISTS (SELECT 1 FROM aa_01_campaigns.raw_orders r WHERE r.campaign_id = oe.campaign_id)
    GROUP BY oe.campaign_id, lower(btrim(oe.email))

    UNION ALL

    -- ISOD — only when neither raw_orders nor order_entitlements covers this campaign.
    SELECT io.campaign_id, lower(btrim(io.customer_email)) AS email,
           SUM(iol.price_paid) AS spend,
           COUNT(DISTINCT io.id)::bigint AS orders
    FROM aa_01_campaigns.isod_orders io
    LEFT JOIN aa_01_campaigns.isod_order_lines iol ON iol.isod_order_id = io.id
    WHERE io.customer_email IS NOT NULL AND io.customer_email <> ''
      AND lower(btrim(io.customer_email)) = ANY(p_emails)
      AND NOT EXISTS (SELECT 1 FROM aa_01_campaigns.raw_orders WHERE campaign_id = io.campaign_id)
      AND NOT EXISTS (SELECT 1 FROM aa_01_campaigns.order_entitlements WHERE campaign_id = io.campaign_id)
    GROUP BY io.campaign_id, lower(btrim(io.customer_email))

    UNION ALL

    -- Historic CSV imports — always counted alongside live activity.
    SELECT hol.campaign_id, lower(btrim(ho.email)) AS email,
           SUM(hol.line_revenue) AS spend,
           COUNT(DISTINCT ho.id)::bigint AS orders
    FROM aa_01_campaigns.historic_order_lines hol
    JOIN aa_01_campaigns.historic_orders ho ON ho.id = hol.historic_order_id
    WHERE ho.order_status = 'paid'
      AND ho.email IS NOT NULL AND ho.email <> ''
      AND hol.campaign_id IS NOT NULL
      AND lower(btrim(ho.email)) = ANY(p_emails)
    GROUP BY hol.campaign_id, lower(btrim(ho.email))
  ),
  aggregated AS (
    SELECT bs.campaign_id, bs.email,
           SUM(bs.spend) AS total_spend, SUM(bs.orders) AS order_count
    FROM backer_spend bs
    GROUP BY bs.campaign_id, bs.email
  )
  SELECT a.campaign_id, a.email,
         (c.first_name || ' '::text) || c.last_name AS full_name,
         a.total_spend, a.order_count,
         coalesce(a.email, '') || ' ' || coalesce(lower((c.first_name || ' '::text) || c.last_name), '') AS search_text,
         now() AS refreshed_at
  FROM aggregated a
  LEFT JOIN aa_02_crm.customers c ON lower(c.email) = a.email;
END;
$function$;

-- ── Incremental driver (own watermark on customers.updated_at → emails) ─────
CREATE OR REPLACE FUNCTION aa_02_crm.refresh_campaign_backers_snapshot_incremental()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','aa_01_campaigns','aa_02_crm'
AS $function$
DECLARE
  v_hwm     timestamptz;
  v_emails  text[];
  v_new_hwm timestamptz;
BEGIN
  SELECT watermark INTO v_hwm
  FROM aa_02_crm.snapshot_watermarks WHERE name = 'campaign_backers';
  IF v_hwm IS NULL THEN
    v_hwm := '-infinity'::timestamptz;
    INSERT INTO aa_02_crm.snapshot_watermarks(name, watermark)
    VALUES ('campaign_backers', v_hwm)
    ON CONFLICT (name) DO NOTHING;
  END IF;

  SELECT array_agg(DISTINCT lower(btrim(email))), max(updated_at)
  INTO v_emails, v_new_hwm
  FROM aa_02_crm.customers
  WHERE updated_at > v_hwm
    AND email IS NOT NULL AND btrim(email) <> '';

  IF v_emails IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM aa_02_crm.refresh_campaign_backers_for_emails(v_emails);

  UPDATE aa_02_crm.snapshot_watermarks
  SET watermark = COALESCE(v_new_hwm, v_hwm)
  WHERE name = 'campaign_backers';

  RETURN array_length(v_emails, 1);
END;
$function$;

-- ── public wrapper + grants ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_campaign_backers_snapshot_incremental()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','aa_02_crm'
AS $function$ SELECT aa_02_crm.refresh_campaign_backers_snapshot_incremental(); $function$;

GRANT EXECUTE ON FUNCTION public.refresh_campaign_backers_snapshot_incremental() TO anon, authenticated;
