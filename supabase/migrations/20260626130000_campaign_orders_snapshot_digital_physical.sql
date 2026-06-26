-- Per-order kind classification: did this order contain DIGITAL
-- lines, PHYSICAL lines, both, or neither (within this campaign)?
-- Not mutually exclusive — a "Blu-ray + Digital Download" bundle
-- order has both flags true and shows under either filter.
--
-- No explicit per-line digital boolean exists in any source. Detection:
--   - Live (mv): variant_legacy_code / variant_name text match;
--     source_platform = 'gumroad' is always digital.
--   - Historic: product_legacy_code / product_name_raw text match;
--     historic-gumroad source_platform is always digital.
--   - ISOD: physical campaign-2 fulfilment by definition.
-- All ILIKE inputs wrapped in coalesce(..., false) so NULL legacy
-- codes don't poison bool_or to NULL (would violate NOT NULL on the
-- new columns).

ALTER TABLE aa_02_crm.campaign_orders_snapshot
  ADD COLUMN IF NOT EXISTS has_digital_lines  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_physical_lines boolean NOT NULL DEFAULT false;

-- Partial indexes to support the kind filter when the user picks one.
CREATE INDEX IF NOT EXISTS campaign_orders_snapshot_digital_idx
  ON aa_02_crm.campaign_orders_snapshot (campaign_id, order_date DESC NULLS LAST)
  WHERE has_digital_lines;
CREATE INDEX IF NOT EXISTS campaign_orders_snapshot_physical_idx
  ON aa_02_crm.campaign_orders_snapshot (campaign_id, order_date DESC NULLS LAST)
  WHERE has_physical_lines;

CREATE OR REPLACE FUNCTION aa_02_crm.refresh_campaign_orders_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_01_campaigns', 'aa_02_crm'
AS $fn$
begin
  TRUNCATE aa_02_crm.campaign_orders_snapshot;

  INSERT INTO aa_02_crm.campaign_orders_snapshot (
    campaign_id, order_key, source, order_number, order_date, email,
    customer_name, status, amount_usd, line_revenue, units,
    product_ids, has_digital_lines, has_physical_lines, refreshed_at
  )
  WITH
  live AS (
    SELECT
      mv.product_campaign_id                                  AS campaign_id,
      ('shopify:' || ro.shopify_order_id)                     AS order_key,
      ro.source_platform                                      AS source,
      ro.shopify_order_number                                 AS order_number,
      coalesce(ro.processed_at, ro.created_at)                AS order_date,
      lower(ro.email)                                         AS email,
      coalesce(
        nullif(btrim(c.first_name || ' ' || coalesce(c.last_name, '')), ''),
        ro.payload #>> '{shipping_address,name}'
      )                                                       AS customer_name,
      ro.financial_status                                     AS status,
      ((ro.payload->>'total_price')::numeric)                 AS amount_usd,
      coalesce(sum(mv.line_revenue), 0)::numeric              AS line_revenue,
      coalesce(sum(mv.quantity), 0)::int                      AS units,
      array_agg(DISTINCT mv.product_id)
        FILTER (WHERE mv.product_id IS NOT NULL)              AS product_ids,
      coalesce(bool_or(
        coalesce(mv.variant_legacy_code ILIKE '%DIGITAL%', false)
        OR coalesce(mv.variant_legacy_code ILIKE '%DOWNLOAD%', false)
        OR coalesce(mv.variant_name ILIKE '%digital%', false)
        OR coalesce(mv.variant_name ILIKE '%download%', false)
        OR ro.source_platform = 'gumroad'
      ), false)                                               AS has_digital_lines,
      coalesce(bool_or(
        NOT (
          coalesce(mv.variant_legacy_code ILIKE '%DIGITAL%', false)
          OR coalesce(mv.variant_legacy_code ILIKE '%DOWNLOAD%', false)
          OR coalesce(mv.variant_name ILIKE '%digital%', false)
          OR coalesce(mv.variant_name ILIKE '%download%', false)
          OR ro.source_platform = 'gumroad'
        )
      ), false)                                               AS has_physical_lines
    FROM aa_01_campaigns.mv_raw_order_line_attribution mv
    JOIN aa_01_campaigns.raw_orders ro ON ro.id = mv.raw_order_id
    LEFT JOIN aa_02_crm.customers c ON lower(c.email) = lower(ro.email)
    WHERE mv.financial_status = 'paid'
      AND mv.product_campaign_id IS NOT NULL
    GROUP BY mv.product_campaign_id, ro.shopify_order_id, ro.source_platform,
             ro.shopify_order_number, ro.processed_at, ro.created_at,
             ro.email, ro.payload, ro.financial_status,
             c.first_name, c.last_name
  ),
  hist AS (
    SELECT
      hol.campaign_id                                         AS campaign_id,
      ('historic:' || ho.id::text)                            AS order_key,
      ho.source_platform                                      AS source,
      ho.source_order_id                                      AS order_number,
      coalesce(ho.order_created_at, ho.created_at)            AS order_date,
      lower(ho.email)                                         AS email,
      coalesce(
        nullif(btrim(c.first_name || ' ' || coalesce(c.last_name, '')), ''),
        ho.shipping_name
      )                                                       AS customer_name,
      ho.order_status                                         AS status,
      ho.gross_amount                                         AS amount_usd,
      coalesce(sum(hol.line_revenue), 0)::numeric             AS line_revenue,
      coalesce(sum(hol.quantity), 0)::int                     AS units,
      array_agg(DISTINCT p.id)
        FILTER (WHERE p.id IS NOT NULL)                       AS product_ids,
      coalesce(bool_or(
        ho.source_platform = 'gumroad'
        OR coalesce(hol.product_legacy_code ILIKE '%DIGITAL%', false)
        OR coalesce(hol.product_legacy_code ILIKE '%DOWNLOAD%', false)
        OR coalesce(hol.product_name_raw ILIKE '%digital%', false)
        OR coalesce(hol.product_name_raw ILIKE '%download%', false)
      ), false)                                               AS has_digital_lines,
      coalesce(bool_or(
        NOT (
          ho.source_platform = 'gumroad'
          OR coalesce(hol.product_legacy_code ILIKE '%DIGITAL%', false)
          OR coalesce(hol.product_legacy_code ILIKE '%DOWNLOAD%', false)
          OR coalesce(hol.product_name_raw ILIKE '%digital%', false)
          OR coalesce(hol.product_name_raw ILIKE '%download%', false)
        )
      ), false)                                               AS has_physical_lines
    FROM aa_01_campaigns.historic_order_lines hol
    JOIN aa_01_campaigns.historic_orders ho ON ho.id = hol.historic_order_id
    LEFT JOIN aa_01_campaigns.products p
      ON p.legacy_code = hol.product_legacy_code
     AND p.campaign_id = hol.campaign_id
    LEFT JOIN aa_02_crm.customers c ON lower(c.email) = lower(ho.email)
    WHERE hol.campaign_id IS NOT NULL
      AND ho.order_status = 'paid'
    GROUP BY hol.campaign_id, ho.id, ho.source_platform, ho.source_order_id,
             ho.order_created_at, ho.created_at, ho.email,
             ho.shipping_name, ho.order_status, ho.gross_amount,
             c.first_name, c.last_name
  ),
  isod AS (
    SELECT
      io.campaign_id                                          AS campaign_id,
      ('isod:' || io.id::text)                                AS order_key,
      'isod'::text                                            AS source,
      coalesce(io.purchase_order_number, io.order_id)         AS order_number,
      coalesce(io.order_created_at, io.created_at)            AS order_date,
      lower(io.customer_email)                                AS email,
      coalesce(
        nullif(btrim(c.first_name || ' ' || coalesce(c.last_name, '')), ''),
        nullif(btrim(coalesce(io.customer_first_name, '') || ' ' || coalesce(io.customer_last_name, '')), ''),
        io.shipping_name
      )                                                       AS customer_name,
      'paid'::text                                            AS status,
      coalesce(r.amount, 0)                                   AS amount_usd,
      coalesce(r.amount, 0)                                   AS line_revenue,
      coalesce(r.units, 0)                                    AS units,
      ARRAY[]::int[]                                          AS product_ids,
      false                                                   AS has_digital_lines,
      true                                                    AS has_physical_lines
    FROM aa_01_campaigns.isod_orders io
    LEFT JOIN LATERAL (
      SELECT
        sum(l.price_paid) AS amount,
        sum(nullif(l.line_quantity, '')::int) AS units
      FROM aa_01_campaigns.isod_order_lines l
      WHERE l.isod_order_id = io.id
    ) r ON true
    LEFT JOIN aa_02_crm.customers c ON lower(c.email) = lower(io.customer_email)
    WHERE io.campaign_id IS NOT NULL
  )
  SELECT campaign_id, order_key, source, order_number, order_date, email,
         customer_name, status, amount_usd, line_revenue, units,
         coalesce(product_ids, '{}'::int[]) AS product_ids,
         has_digital_lines, has_physical_lines,
         now() AS refreshed_at
  FROM live
  UNION ALL
  SELECT campaign_id, order_key, source, order_number, order_date, email,
         customer_name, status, amount_usd, line_revenue, units,
         coalesce(product_ids, '{}'::int[]) AS product_ids,
         has_digital_lines, has_physical_lines,
         now() AS refreshed_at
  FROM hist
  UNION ALL
  SELECT campaign_id, order_key, source, order_number, order_date, email,
         customer_name, status, amount_usd, line_revenue, units,
         product_ids, has_digital_lines, has_physical_lines,
         now() AS refreshed_at
  FROM isod;
end;
$fn$;

SELECT aa_02_crm.refresh_campaign_orders_snapshot();

-- ── Reader + summary RPCs gain p_kinds text[] filter ───────────
-- Empty/null = no filter. Valid values 'digital','physical'. Both
-- selected = OR of the two flags (effectively no filter, since every
-- row has at least one of them populated).
DROP FUNCTION IF EXISTS public.get_campaign_orders(int, int[], timestamptz, timestamptz, int, int);
CREATE OR REPLACE FUNCTION public.get_campaign_orders(
  p_campaign_id int,
  p_product_ids int[]       DEFAULT NULL,
  p_start_date  timestamptz DEFAULT NULL,
  p_end_date    timestamptz DEFAULT NULL,
  p_kinds       text[]      DEFAULT NULL,
  p_page        int  DEFAULT 1,
  p_page_size   int  DEFAULT 100
)
RETURNS TABLE(
  order_key          text,
  source             text,
  order_number       text,
  order_date         timestamptz,
  email              text,
  customer_name      text,
  status             text,
  amount_usd         numeric,
  product_ids        int[],
  has_digital_lines  boolean,
  has_physical_lines boolean,
  total_count        bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_02_crm'
AS $$
  WITH filtered AS (
    SELECT order_key, source, order_number, order_date, email,
           customer_name, status, amount_usd, product_ids,
           has_digital_lines, has_physical_lines
    FROM aa_02_crm.campaign_orders_snapshot
    WHERE campaign_id = p_campaign_id
      AND (
        p_product_ids IS NULL
        OR cardinality(p_product_ids) = 0
        OR product_ids && p_product_ids
      )
      AND (p_start_date IS NULL OR order_date >= p_start_date)
      AND (p_end_date   IS NULL OR order_date <  p_end_date)
      AND (
        p_kinds IS NULL OR cardinality(p_kinds) = 0
        OR (has_digital_lines  AND 'digital'  = ANY(p_kinds))
        OR (has_physical_lines AND 'physical' = ANY(p_kinds))
      )
  )
  SELECT
    order_key, source, order_number, order_date, email,
    customer_name, status, amount_usd, product_ids,
    has_digital_lines, has_physical_lines,
    count(*) OVER()::bigint AS total_count
  FROM filtered
  ORDER BY order_date DESC NULLS LAST, order_key
  LIMIT p_page_size
  OFFSET (p_page - 1) * p_page_size;
$$;

GRANT EXECUTE ON FUNCTION public.get_campaign_orders(int, int[], timestamptz, timestamptz, text[], int, int)
  TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_campaign_orders_summary(int, int[], timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION public.get_campaign_orders_summary(
  p_campaign_id int,
  p_product_ids int[]       DEFAULT NULL,
  p_start_date  timestamptz DEFAULT NULL,
  p_end_date    timestamptz DEFAULT NULL,
  p_kinds       text[]      DEFAULT NULL
)
RETURNS TABLE(
  total_orders   bigint,
  total_revenue  numeric,
  unique_backers bigint,
  total_units    bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_02_crm'
AS $$
  SELECT
    count(*)::bigint                                   AS total_orders,
    coalesce(sum(line_revenue), 0)::numeric            AS total_revenue,
    count(DISTINCT email) FILTER (WHERE email IS NOT NULL)::bigint AS unique_backers,
    coalesce(sum(units), 0)::bigint                    AS total_units
  FROM aa_02_crm.campaign_orders_snapshot
  WHERE campaign_id = p_campaign_id
    AND (
      p_product_ids IS NULL
      OR cardinality(p_product_ids) = 0
      OR product_ids && p_product_ids
    )
    AND (p_start_date IS NULL OR order_date >= p_start_date)
    AND (p_end_date   IS NULL OR order_date <  p_end_date)
    AND (
      p_kinds IS NULL OR cardinality(p_kinds) = 0
      OR (has_digital_lines  AND 'digital'  = ANY(p_kinds))
      OR (has_physical_lines AND 'physical' = ANY(p_kinds))
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_campaign_orders_summary(int, int[], timestamptz, timestamptz, text[])
  TO anon, authenticated, service_role;
