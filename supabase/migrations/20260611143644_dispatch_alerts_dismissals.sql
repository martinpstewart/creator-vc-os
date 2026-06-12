-- Dispatch monitor: per-payment dismissal mechanism.
--
-- The dispatch banner flags paid Payhere payments that haven't
-- reached Acutrack. The assumption baked in (every paid Payhere
-- payment SHOULD ship via Acutrack) doesn't always hold — some
-- payments are for campaigns that fulfil through other channels,
-- and others come in without an order_id so the monitor can't tell
-- which campaign they belong to.
--
-- This migration adds:
--   1. payhere_dismissed_alerts: small audit table, one row per
--      dismissed payhere_id, with a free-text reason + actor.
--   2. dismiss_dispatch_alert(p_payhere_id, p_reason): owner-only
--      RPC. Upsert so dismissing the same payment twice updates the
--      reason rather than erroring.
--   3. undismiss_dispatch_alert(p_payhere_id): owner-only RPC to
--      undo a dismissal if it was a mistake.
--   4. is_owner(): server-side mirror of lib/auth.ts isOwner so the
--      DB and UI agree on who can dismiss. One line to flip if
--      ownership ever changes.
--   5. get_dispatch_alerts: now excludes dismissed payment ids via
--      a NOT EXISTS guard.
--   6. Seed dismissal for Gary's payhere_id 420001 (order is for
--      another campaign that doesn't ship via Acutrack).

CREATE TABLE IF NOT EXISTS aa_01_campaigns.payhere_dismissed_alerts (
  payhere_id   bigint PRIMARY KEY,
  reason       text   NOT NULL,
  dismissed_by uuid   NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON aa_01_campaigns.payhere_dismissed_alerts FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = auth.uid()
      AND lower(u.email) = 'martinpstewart@gmail.com'
  );
$$;

REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_owner() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.dismiss_dispatch_alert(
  p_payhere_id bigint,
  p_reason     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, aa_01_campaigns
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
BEGIN
  IF v_caller IS NULL OR NOT public.is_owner() THEN
    RAISE EXCEPTION 'forbidden: owner only' USING errcode = '42501';
  END IF;
  IF p_payhere_id IS NULL THEN
    RAISE EXCEPTION 'payhere_id is required' USING errcode = '22023';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reason is required' USING errcode = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM aa_01_campaigns.payhere_payments WHERE payhere_id = p_payhere_id) THEN
    RAISE EXCEPTION 'no such payhere_id: %', p_payhere_id USING errcode = '22023';
  END IF;

  INSERT INTO aa_01_campaigns.payhere_dismissed_alerts (payhere_id, reason, dismissed_by, dismissed_at)
  VALUES (p_payhere_id, v_reason, v_caller, now())
  ON CONFLICT (payhere_id) DO UPDATE
    SET reason       = excluded.reason,
        dismissed_by = excluded.dismissed_by,
        dismissed_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_dispatch_alert(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dismiss_dispatch_alert(bigint, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.undismiss_dispatch_alert(p_payhere_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, aa_01_campaigns
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_owner() THEN
    RAISE EXCEPTION 'forbidden: owner only' USING errcode = '42501';
  END IF;
  DELETE FROM aa_01_campaigns.payhere_dismissed_alerts WHERE payhere_id = p_payhere_id;
END;
$$;

REVOKE ALL ON FUNCTION public.undismiss_dispatch_alert(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undismiss_dispatch_alert(bigint) TO anon, authenticated;

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
  flagged AS (
    SELECT
      p.payhere_id, p.order_id, p.customer_email, p.amount, p.currency,
      p.status, p.payhere_created_at,
      CASE WHEN p.order_id IS NULL THEN 'unlinkable_no_order_id'
           ELSE 'missing_from_acutrack' END AS reason
    FROM aa_01_campaigns.payhere_payments p, cov
    WHERE p.success = true
      AND (p.order_id IS NULL OR p.order_id NOT ILIKE 'TEST-%')
      AND cov.received_rows > 0
      AND cov.as_of_date IS NOT NULL
      AND p.payhere_created_at < now() - interval '24 hours'
      AND p.payhere_created_at::date <= cov.as_of_date
      AND (
        p.order_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM aa_01_campaigns.acutrack_received a
          WHERE btrim(a.ponumber) = btrim(p.order_id)
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM aa_01_campaigns.payhere_dismissed_alerts d
        WHERE d.payhere_id = p.payhere_id
      )
  )
  SELECT jsonb_build_object(
    'last_import_at', (SELECT last_import_at FROM cov),
    'as_of_date',     (SELECT as_of_date FROM cov),
    'received_rows',  (SELECT received_rows FROM cov),
    'count',          (SELECT count(*) FROM flagged),
    'orders',         coalesce(
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

-- Seed: Gary's payhere_id 420001. Attributed to the owner if their
-- auth.users row exists; ON CONFLICT DO NOTHING makes the migration
-- safe to re-run.
INSERT INTO aa_01_campaigns.payhere_dismissed_alerts (payhere_id, reason, dismissed_by, dismissed_at)
SELECT 420001, 'order is for another campaign — does not ship via Acutrack', u.id, now()
FROM auth.users u
WHERE lower(u.email) = 'martinpstewart@gmail.com'
ON CONFLICT (payhere_id) DO NOTHING;
