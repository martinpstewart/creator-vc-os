-- Per-campaign orders snapshot, with product_ids array for multi-select
-- filtering. Driving rows union three sources:
--   1) raw_orders via mv_raw_order_line_attribution  (Shopify + Gumroad live)
--   2) historic_orders + historic_order_lines        (CSV imports)
--   3) isod_orders                                    (campaign 2 only)
--
-- Same pattern as campaign_backers_snapshot: one row per
-- (campaign_id, order_key), refreshed by cron, fast paginated reads with
-- GIN-backed product filter.

CREATE TABLE IF NOT EXISTS aa_02_crm.campaign_orders_snapshot (
  campaign_id    int  NOT NULL,
  order_key      text NOT NULL,
  source         text NOT NULL,
  order_number   text,
  order_date     timestamptz,
  email          text,
  customer_name  text,
  status         text,
  amount_usd     numeric,
  product_ids    int[] NOT NULL DEFAULT '{}',
  refreshed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, order_key)
);
GRANT SELECT ON aa_02_crm.campaign_orders_snapshot TO anon, authenticated;

-- Default ordering: (campaign, order_date DESC). Composite so the
-- reader's WHERE campaign_id = ? ORDER BY order_date DESC is an
-- index-only scan.
CREATE INDEX IF NOT EXISTS campaign_orders_snapshot_campaign_date_idx
  ON aa_02_crm.campaign_orders_snapshot (campaign_id, order_date DESC NULLS LAST, order_key);

-- GIN for product multi-select. `&&` (overlap) lets us answer
-- "orders containing any of these products".
CREATE INDEX IF NOT EXISTS campaign_orders_snapshot_product_ids_gin
  ON aa_02_crm.campaign_orders_snapshot USING gin (product_ids);

-- ── Refresh proc ───────────────────────────────────────────────
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
    customer_name, status, amount_usd, product_ids, refreshed_at
  )
  WITH
  -- ── Shopify / Gumroad live (raw_orders), driven by the matview so the
  -- attribution column matches the catalogue tab + backers tab semantics:
  -- an order appears under EVERY campaign it sold a product for, not just
  -- its primary campaign. Cross-sell-aware.
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
  -- ── Historic CSV imports — driven by historic_order_lines.campaign_id
  -- so cross-sell historic orders show under both campaigns. product_ids
  -- resolved by joining aa_01_campaigns.products on legacy_code.
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
  -- ── ISOD orders (campaign 2). ISOD lines don't have product_id
  -- mapping in aa_01_campaigns.products, so product_ids stays empty —
  -- ISOD orders show only when no product filter is applied, which
  -- matches expectation: campaign 2's catalogue doesn't expose a
  -- canonical product list to pick from anyway.
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
      r.amount                                                AS amount_usd,
      ARRAY[]::int[]                                          AS product_ids
    FROM aa_01_campaigns.isod_orders io
    LEFT JOIN LATERAL (
      SELECT sum(l.price_paid) AS amount
      FROM aa_01_campaigns.isod_order_lines l
      WHERE l.isod_order_id = io.id
    ) r ON true
    LEFT JOIN aa_02_crm.customers c ON lower(c.email) = lower(io.customer_email)
    WHERE io.campaign_id IS NOT NULL
  )
  SELECT campaign_id, order_key, source, order_number, order_date, email,
         customer_name, status, amount_usd,
         coalesce(product_ids, '{}'::int[]) AS product_ids,
         now() AS refreshed_at
  FROM live
  UNION ALL
  SELECT campaign_id, order_key, source, order_number, order_date, email,
         customer_name, status, amount_usd,
         coalesce(product_ids, '{}'::int[]) AS product_ids,
         now() AS refreshed_at
  FROM hist
  UNION ALL
  SELECT campaign_id, order_key, source, order_number, order_date, email,
         customer_name, status, amount_usd,
         product_ids,
         now() AS refreshed_at
  FROM isod;
end;
$$;

-- Public wrapper for cron + admin manual refresh
CREATE OR REPLACE FUNCTION public.refresh_campaign_orders_snapshot()
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_02_crm'
AS $$ SELECT aa_02_crm.refresh_campaign_orders_snapshot(); $$;
REVOKE ALL ON FUNCTION public.refresh_campaign_orders_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_campaign_orders_snapshot() TO service_role, authenticated;

-- ── Reader RPC ─────────────────────────────────────────────────
-- p_product_ids NULL or empty = no product filter.
-- Returns paginated orders + total_count via window fn.
CREATE OR REPLACE FUNCTION public.get_campaign_orders(
  p_campaign_id int,
  p_product_ids int[] DEFAULT NULL,
  p_start_date  timestamptz DEFAULT NULL,
  p_end_date    timestamptz DEFAULT NULL,
  p_page        int  DEFAULT 1,
  p_page_size   int  DEFAULT 100
)
RETURNS TABLE(
  order_key     text,
  source        text,
  order_number  text,
  order_date    timestamptz,
  email         text,
  customer_name text,
  status        text,
  amount_usd    numeric,
  product_ids   int[],
  total_count   bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'aa_02_crm'
AS $$
  WITH filtered AS (
    SELECT order_key, source, order_number, order_date, email,
           customer_name, status, amount_usd, product_ids
    FROM aa_02_crm.campaign_orders_snapshot
    WHERE campaign_id = p_campaign_id
      AND (
        p_product_ids IS NULL
        OR cardinality(p_product_ids) = 0
        OR product_ids && p_product_ids
      )
      AND (p_start_date IS NULL OR order_date >= p_start_date)
      AND (p_end_date   IS NULL OR order_date <  p_end_date)
  )
  SELECT
    order_key, source, order_number, order_date, email,
    customer_name, status, amount_usd, product_ids,
    count(*) OVER()::bigint AS total_count
  FROM filtered
  ORDER BY order_date DESC NULLS LAST, order_key
  LIMIT p_page_size
  OFFSET (p_page - 1) * p_page_size;
$$;

GRANT EXECUTE ON FUNCTION public.get_campaign_orders(int, int[], timestamptz, timestamptz, int, int)
  TO anon, authenticated, service_role;

-- ── Initial populate + cron schedule ───────────────────────────
SELECT aa_02_crm.refresh_campaign_orders_snapshot();

-- Hourly at minute 25 — clear of existing snapshot jobs:
--   5: customer_list */2     6: campaigns_list :35    7: backers */5
--  10: matview 7/22/37/52
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-campaign-orders-snapshot') THEN
    PERFORM cron.schedule(
      'refresh-campaign-orders-snapshot',
      '25 * * * *',
      $cron$SELECT public.refresh_campaign_orders_snapshot();$cron$
    );
  END IF;
END$$;
