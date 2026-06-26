-- Add per-campaign attributed line_revenue + units to the orders
-- snapshot, plus a summary RPC for the Orders-tab KPI header.
--
-- Why a separate line_revenue alongside amount_usd:
--   - amount_usd = whole order total (good for per-row display)
--   - line_revenue = sum of THIS campaign's lines on this order
--     (correct for aggregate "campaign revenue" — matches how
--     campaigns_list_snapshot.total_revenue is computed elsewhere).
-- Same reasoning for units (campaign-attributed line quantities, not
-- whole-order item count).

ALTER TABLE aa_02_crm.campaign_orders_snapshot
  ADD COLUMN IF NOT EXISTS line_revenue numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS units        int     NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION aa_02_crm.refresh_campaign_orders_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_01_campaigns', 'aa_02_crm'
AS $$
begin
  TRUNCATE aa_02_crm.campaign_orders_snapshot;

  INSERT INTO aa_02_crm.campaign_orders_snapshot (
    campaign_id, order_key, source, order_number, order_date, email,
    customer_name, status, amount_usd, line_revenue, units,
    product_ids, refreshed_at
  )
  WITH
  -- Shopify / Gumroad live — matview already carries line_revenue and
  -- quantity per attributed line. Sum at order × product_campaign.
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
        FILTER (WHERE mv.product_id IS NOT NULL)              AS product_ids
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
  -- Historic CSV — line_revenue + quantity per line are stored
  -- directly in historic_order_lines.
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
        FILTER (WHERE p.id IS NOT NULL)                       AS product_ids
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
  -- ISOD — line totals from isod_order_lines (price_paid summed per
  -- order, line_quantity is text → cast carefully).
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
      ARRAY[]::int[]                                          AS product_ids
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
         now() AS refreshed_at
  FROM live
  UNION ALL
  SELECT campaign_id, order_key, source, order_number, order_date, email,
         customer_name, status, amount_usd, line_revenue, units,
         coalesce(product_ids, '{}'::int[]) AS product_ids,
         now() AS refreshed_at
  FROM hist
  UNION ALL
  SELECT campaign_id, order_key, source, order_number, order_date, email,
         customer_name, status, amount_usd, line_revenue, units,
         product_ids,
         now() AS refreshed_at
  FROM isod;
end;
$$;

-- Repopulate now so the new columns are filled.
SELECT aa_02_crm.refresh_campaign_orders_snapshot();

-- ── Summary aggregation for the KPI header ─────────────────────
-- Mirrors get_campaign_orders's filter semantics so the header
-- numbers always match what's shown in the table below.
CREATE OR REPLACE FUNCTION public.get_campaign_orders_summary(
  p_campaign_id int,
  p_product_ids int[]       DEFAULT NULL,
  p_start_date  timestamptz DEFAULT NULL,
  p_end_date    timestamptz DEFAULT NULL
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
    AND (p_end_date   IS NULL OR order_date <  p_end_date);
$$;

GRANT EXECUTE ON FUNCTION public.get_campaign_orders_summary(int, int[], timestamptz, timestamptz)
  TO anon, authenticated, service_role;
