-- Step 1 of the A1 incremental customer_list_snapshot work.
-- Adds the watermark control table and the indexes the scoped
-- row-builder relies on. No reads/writes against the snapshot here
-- — pure schema prep.

-- Control table holding the last-processed updated_at per snapshot.
CREATE TABLE IF NOT EXISTS aa_02_crm.snapshot_watermarks (
  name      text PRIMARY KEY,
  watermark timestamptz NOT NULL DEFAULT '-infinity'
);

-- Fast "which customers changed since last run" range scan.
CREATE INDEX IF NOT EXISTS idx_crm_customers_updated_at
  ON aa_02_crm.customers (updated_at);

-- Support fast per-customer paying checks. These match the
-- v_paying_customer_emails view semantics exactly: lower(btrim(email)),
-- with the paid filter pushed into the index where the view applies one.
CREATE INDEX IF NOT EXISTS idx_raw_orders_email_btrim_paid
  ON aa_01_campaigns.raw_orders (lower(btrim(email)))
  WHERE financial_status = 'paid';

CREATE INDEX IF NOT EXISTS idx_historic_orders_email_btrim_paid
  ON aa_01_campaigns.historic_orders (lower(btrim(email)))
  WHERE order_status = 'paid';

CREATE INDEX IF NOT EXISTS idx_isod_orders_email_btrim
  ON aa_01_campaigns.isod_orders (lower(btrim(customer_email)));
