-- Rename campaign 7's legacy_code so the shopify-webhook routing regex
-- matches order numbers like "#19562-ISOD-70s". The function maps order
-- numbers to legacy codes by uppercasing and swapping hyphens for
-- underscores, then exact-matches campaigns.legacy_code. Every other
-- campaign already followed that convention; this one was the outlier.
--
-- Symptom: ISOD 70s orders fell through to the shop_domain default
-- (campaign 1) instead of campaign 7. Fixed in data on 2026-06-26;
-- this migration captures the rename for repo parity.
update aa_01_campaigns.campaigns
   set legacy_code = 'ISOD_70S'
 where id = 7
   and legacy_code = 'isod-70s';
