-- Step 2 of the A1 incremental customer_list_snapshot work.
-- Defines the scoped row-builder, the watermark-driven driver, and
-- the public RPC wrapper + grants.

-- ── Scoped row-builder ────────────────────────────────────────────────────
-- Upserts/deletes customer_list_snapshot rows for a specific set of customer
-- ids. Row shape is identical to the full refresh_customer_list_snapshot();
-- the only difference is the paying filter is expressed as index-backed
-- per-email EXISTS (same semantics as v_paying_customer_emails) so it stays
-- cheap for a handful of ids instead of materialising the whole view.
CREATE OR REPLACE FUNCTION aa_02_crm.refresh_customer_list_snapshot_changed(p_ids bigint[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','aa_01_campaigns','aa_02_crm'
AS $function$
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO aa_02_crm.customer_list_snapshot (
    id, email, full_name, total_orders, total_spend,
    shipping_city, shipping_country, is_backer,
    campaign_orders_detail, raw_orders_detail, isod_orders_detail, historic_orders_detail,
    campaign_ids, source_platforms, search_text, refreshed_at
  )
  SELECT
    cs.id, cs.email, cs.full_name, cs.total_orders,
    coalesce(cs.total_spend, 0) AS total_spend,
    cs.shipping_city, cs.shipping_country, cs.is_backer,
    cs.campaign_orders_detail, cs.raw_orders_detail,
    cs.isod_orders_detail, cs.historic_orders_detail,
    (
      SELECT array_agg(DISTINCT (d->>'campaign_id')::int)
      FROM (
        SELECT jsonb_array_elements(coalesce(cs.campaign_orders_detail, '[]'::jsonb)) AS d
        UNION ALL
        SELECT jsonb_array_elements(coalesce(cs.raw_orders_detail, '[]'::jsonb))
        UNION ALL
        SELECT jsonb_array_elements(coalesce(cs.isod_orders_detail, '[]'::jsonb))
        UNION ALL
        SELECT jsonb_array_elements(coalesce(cs.historic_orders_detail, '[]'::jsonb))
      ) flat
      WHERE d ? 'campaign_id'
    ) AS campaign_ids,
    (
      SELECT array_agg(DISTINCT plat)
      FROM (
        SELECT CASE WHEN jsonb_array_length(coalesce(cs.raw_orders_detail, '[]'::jsonb)) > 0
                    THEN 'shopify' END AS plat
        UNION ALL
        SELECT CASE WHEN jsonb_array_length(coalesce(cs.isod_orders_detail, '[]'::jsonb)) > 0
                    THEN 'isod' END
        UNION ALL
        SELECT DISTINCT d->>'source'
        FROM jsonb_array_elements(coalesce(cs.historic_orders_detail, '[]'::jsonb)) d
        WHERE d ? 'source'
      ) flat
      WHERE plat IS NOT NULL
    ) AS source_platforms,
    coalesce(lower(cs.email), '') || ' ' || coalesce(lower(cs.full_name), '') AS search_text,
    now() AS refreshed_at
  FROM aa_02_crm.customer_summary cs
  WHERE cs.id = ANY(p_ids)
    AND (
      EXISTS (SELECT 1 FROM aa_01_campaigns.raw_orders ro
              WHERE lower(btrim(ro.email)) = lower(cs.email)
                AND ro.financial_status = 'paid')
      OR EXISTS (SELECT 1 FROM aa_01_campaigns.historic_orders ho
                 WHERE lower(btrim(ho.email)) = lower(cs.email)
                   AND ho.order_status = 'paid')
      OR EXISTS (SELECT 1 FROM aa_01_campaigns.isod_orders io
                 WHERE lower(btrim(io.customer_email)) = lower(cs.email))
    )
  ON CONFLICT (id) DO UPDATE SET
    email                  = excluded.email,
    full_name              = excluded.full_name,
    total_orders           = excluded.total_orders,
    total_spend            = excluded.total_spend,
    shipping_city          = excluded.shipping_city,
    shipping_country       = excluded.shipping_country,
    is_backer              = excluded.is_backer,
    campaign_orders_detail = excluded.campaign_orders_detail,
    raw_orders_detail      = excluded.raw_orders_detail,
    isod_orders_detail     = excluded.isod_orders_detail,
    historic_orders_detail = excluded.historic_orders_detail,
    campaign_ids           = excluded.campaign_ids,
    source_platforms       = excluded.source_platforms,
    search_text            = excluded.search_text,
    refreshed_at           = excluded.refreshed_at;

  -- Remove rows for changed customers that are no longer paying (or deleted).
  DELETE FROM aa_02_crm.customer_list_snapshot s
  WHERE s.id = ANY(p_ids)
    AND NOT EXISTS (
      SELECT 1 FROM aa_02_crm.customers c
      WHERE c.id = s.id
        AND (
          EXISTS (SELECT 1 FROM aa_01_campaigns.raw_orders ro
                  WHERE lower(btrim(ro.email)) = lower(c.email)
                    AND ro.financial_status = 'paid')
          OR EXISTS (SELECT 1 FROM aa_01_campaigns.historic_orders ho
                     WHERE lower(btrim(ho.email)) = lower(c.email)
                       AND ho.order_status = 'paid')
          OR EXISTS (SELECT 1 FROM aa_01_campaigns.isod_orders io
                     WHERE lower(btrim(io.customer_email)) = lower(c.email))
        )
    );
END;
$function$;

-- ── Incremental driver ────────────────────────────────────────────────────
-- Processes only customers changed since the stored watermark, then advances
-- the watermark. Strictly-greater (>) avoids reprocessing the boundary batch;
-- the nightly full rebuild reconciles any boundary-tie / race drift.
CREATE OR REPLACE FUNCTION aa_02_crm.refresh_customer_list_snapshot_incremental()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','aa_01_campaigns','aa_02_crm'
AS $function$
DECLARE
  v_hwm     timestamptz;
  v_ids     bigint[];
  v_new_hwm timestamptz;
BEGIN
  SELECT watermark INTO v_hwm
  FROM aa_02_crm.snapshot_watermarks WHERE name = 'customer_list';
  IF v_hwm IS NULL THEN
    v_hwm := '-infinity'::timestamptz;
    INSERT INTO aa_02_crm.snapshot_watermarks(name, watermark)
    VALUES ('customer_list', v_hwm)
    ON CONFLICT (name) DO NOTHING;
  END IF;

  SELECT array_agg(id), max(updated_at)
  INTO v_ids, v_new_hwm
  FROM aa_02_crm.customers
  WHERE updated_at > v_hwm;

  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM aa_02_crm.refresh_customer_list_snapshot_changed(v_ids);

  UPDATE aa_02_crm.snapshot_watermarks
  SET watermark = COALESCE(v_new_hwm, v_hwm)
  WHERE name = 'customer_list';

  RETURN array_length(v_ids, 1);
END;
$function$;

-- ── public wrapper + grants (RPC permission rule) ─────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_customer_list_snapshot_incremental()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','aa_02_crm'
AS $function$ SELECT aa_02_crm.refresh_customer_list_snapshot_incremental(); $function$;

GRANT EXECUTE ON FUNCTION public.refresh_customer_list_snapshot_incremental() TO anon, authenticated;
