-- Materialise the attribution view once. Same columns (SELECT *), so it's a
-- drop-in for consumers we repoint. Unique index is required for
-- REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE MATERIALIZED VIEW aa_01_campaigns.mv_raw_order_line_attribution AS
SELECT * FROM aa_01_campaigns.v_raw_order_line_attribution
WITH DATA;

CREATE UNIQUE INDEX mv_raw_order_line_attribution_pk
  ON aa_01_campaigns.mv_raw_order_line_attribution (raw_order_id, line_index);

-- Cheap helper for the most common consumer grouping (paid product-campaign rollups).
CREATE INDEX mv_rola_paid_campaign_idx
  ON aa_01_campaigns.mv_raw_order_line_attribution (product_campaign_id)
  WHERE financial_status = 'paid';
