-- Backfill payhere_payments.order_id from raw.custom_fields.order_ID.
-- The poller had a casing bug — it read raw.custom_fields.order_id
-- (lowercase) but Payhere keys it by the plan form's label, which
-- is "order_ID" (capital ID). Result: every row where the source
-- has the field landed with order_id NULL.
--
-- Fixed in payhere-poll v3 going forward (now in
-- supabase/functions/payhere-poll/); this migration recovers the
-- historic rows. Only touches rows where order_id is currently null
-- and a recoverable value exists, so it's safe to re-run.

UPDATE aa_01_campaigns.payhere_payments
SET order_id = btrim(raw->'custom_fields'->>'order_ID')
WHERE order_id IS NULL
  AND coalesce(btrim(raw->'custom_fields'->>'order_ID'), '') <> '';
