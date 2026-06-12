-- Dispatch monitor: two fixes from the audit on 2026-06-12.
--
-- Bug A — bare-numeric PO numbers (#55796, 1624) can collide across
-- campaigns. Today the Acutrack export is only a 14-day window so
-- the risk is dormant, but if Acutrack ever uploads a longer
-- snapshot — or two campaigns run concurrently with overlapping
-- Shopify numbering — false-positive matches will silently hide
-- real shipping failures. Fix: bare-numeric matches now also require
-- the Acutrack date_created to be within ±14 days of payhere_created_at.
-- Campaign-tagged (#NNNN-THING-EXPANDED) stays loose because the
-- suffix already guarantees campaign uniqueness.
--
-- Bug B — payments newer than the Acutrack export's as_of_date are
-- silently excluded from evaluation (the gate is `<= cov.as_of_date`).
-- The banner has no way to tell the operator "you have 50 unchecked
-- payments newer than your last Acutrack upload." Fix: a new
-- not_yet_checkable count in the response, separate from the red
-- flag list, so the banner surfaces the unchecked bucket as its own
-- amber sub-strip.

CREATE OR REPLACE FUNCTION public.get_dispatch_alerts()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = aa_01_campaigns, public
AS $$
  WITH cov AS (
    SELECT
      max(loaded_at)                                            AS last_import_at,
      max(to_date(nullif(btrim(date_created),''), 'MM/DD/YYYY')) AS as_of_date,
      count(*)                                                  AS received_rows
    FROM aa_01_campaigns.acutrack_received
  ),
  in_window AS (
    SELECT p.*
    FROM aa_01_campaigns.payhere_payments p, cov
    WHERE p.success = true
      AND (p.order_id IS NULL OR p.order_id NOT ILIKE 'TEST-%')
      AND cov.received_rows > 0
      AND cov.as_of_date IS NOT NULL
      AND p.payhere_created_at < now() - interval '24 hours'
      AND p.payhere_created_at::date <= cov.as_of_date
  ),
  not_yet_checkable AS (
    SELECT count(*)::int AS n
    FROM aa_01_campaigns.payhere_payments p, cov
    WHERE p.success = true
      AND (p.order_id IS NULL OR p.order_id NOT ILIKE 'TEST-%')
      AND cov.received_rows > 0
      AND cov.as_of_date IS NOT NULL
      AND p.payhere_created_at < now() - interval '24 hours'
      AND p.payhere_created_at::date > cov.as_of_date
  ),
  flagged AS (
    SELECT
      p.payhere_id, p.order_id, p.customer_email, p.amount, p.currency,
      p.status, p.payhere_created_at,
      CASE WHEN p.order_id IS NULL THEN 'unlinkable_no_order_id'
           ELSE 'missing_from_acutrack' END AS reason
    FROM in_window p
    WHERE (
      p.order_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM aa_01_campaigns.acutrack_received a
        WHERE btrim(a.ponumber) = btrim(p.order_id)
          AND (
            btrim(p.order_id) ~* '-(THING|ALIENS|FPS|TERROR|ISOD)'
            OR abs(
              extract(
                epoch from
                  p.payhere_created_at
                  - to_date(nullif(btrim(a.date_created),''),'MM/DD/YYYY')
              ) / 86400
            ) <= 14
          )
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM aa_01_campaigns.payhere_dismissed_alerts d
      WHERE d.payhere_id = p.payhere_id
    )
  )
  SELECT jsonb_build_object(
    'last_import_at',    (SELECT last_import_at FROM cov),
    'as_of_date',        (SELECT as_of_date FROM cov),
    'received_rows',     (SELECT received_rows FROM cov),
    'count',             (SELECT count(*) FROM flagged),
    'not_yet_checkable', (SELECT n FROM not_yet_checkable),
    'orders',            coalesce(
                           (SELECT jsonb_agg(jsonb_build_object(
                               'payhere_id', payhere_id,
                               'order_id',   order_id,
                               'email',      customer_email,
                               'amount',     amount,
                               'currency',   currency,
                               'status',     status,
                               'paid_at',    payhere_created_at,
                               'reason',     reason
                             ) ORDER BY payhere_created_at DESC)
                            FROM flagged), '[]'::jsonb)
  );
$$;
