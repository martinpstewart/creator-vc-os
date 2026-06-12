-- Audit + idempotency for the "auto-retrigger to Glide on CSV
-- commit" flow. After an Acutrack CSV import lands, the edge function
-- glide-retrigger-missing queries get_dispatch_orders_to_retrigger()
-- and POSTs each row to Glide's webhook (URL stored as a Supabase
-- secret). Every attempt — success or failure — is logged here.
--
-- Idempotency window: the helper RPC excludes payhere_ids that
-- already have a SUCCESSFUL retrigger in the last 24 hours, so a
-- rapid sequence of re-uploads doesn't spam Glide for the same set.

CREATE TABLE IF NOT EXISTS aa_01_campaigns.payhere_retrigger_log (
  id          bigserial PRIMARY KEY,
  payhere_id  bigint NOT NULL,
  attempt_at  timestamptz NOT NULL DEFAULT now(),
  success     boolean NOT NULL,
  http_status integer,
  error_text  text
);
CREATE INDEX IF NOT EXISTS payhere_retrigger_log_payhere_idx
  ON aa_01_campaigns.payhere_retrigger_log (payhere_id, attempt_at DESC);

REVOKE ALL ON aa_01_campaigns.payhere_retrigger_log FROM PUBLIC;
REVOKE ALL ON SEQUENCE aa_01_campaigns.payhere_retrigger_log_id_seq FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_dispatch_orders_to_retrigger()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, aa_01_campaigns
AS $$
DECLARE
  v_orders jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_owner() THEN
    RAISE EXCEPTION 'forbidden: owner only' USING errcode = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(o), '[]'::jsonb)
    INTO v_orders
  FROM jsonb_array_elements(public.get_dispatch_alerts()->'orders') AS o
  WHERE NOT EXISTS (
    SELECT 1 FROM aa_01_campaigns.payhere_retrigger_log r
    WHERE r.payhere_id = (o->>'payhere_id')::bigint
      AND r.success = true
      AND r.attempt_at > now() - interval '24 hours'
  );

  RETURN jsonb_build_object('orders', v_orders);
END;
$$;

REVOKE ALL ON FUNCTION public.get_dispatch_orders_to_retrigger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dispatch_orders_to_retrigger() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_payhere_retrigger(
  p_payhere_id bigint,
  p_success    boolean,
  p_http_status integer,
  p_error_text text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, aa_01_campaigns
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_owner() THEN
    RAISE EXCEPTION 'forbidden: owner only' USING errcode = '42501';
  END IF;
  INSERT INTO aa_01_campaigns.payhere_retrigger_log (payhere_id, success, http_status, error_text)
  VALUES (p_payhere_id, p_success, p_http_status, p_error_text);
END;
$$;

REVOKE ALL ON FUNCTION public.log_payhere_retrigger(bigint, boolean, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_payhere_retrigger(bigint, boolean, integer, text) TO anon, authenticated;
