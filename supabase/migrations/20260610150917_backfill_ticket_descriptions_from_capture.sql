-- One-off backfill: extract the description field from
-- public._freshdesk_capture.raw_body for every ticket whose
-- description column is null, and write it back.
--
-- Companion fix: supabase/functions/freshdesk-webhook v9 captures
-- description in the regex fallback path (was hard-coded to null
-- pre-v9, which is why every previously-ingested ticket lacks a
-- body). New tickets will arrive populated; this migration covers
-- the existing rows.
--
-- Idempotent: only touches rows where description IS NULL, so
-- re-running is a no-op.
--
-- Limit: tickets created before the _freshdesk_capture scratch
-- table existed have no raw_body to extract from and stay null.
WITH latest_capture AS (
  SELECT DISTINCT ON ((c.raw_body)::text)
    (substring(c.raw_body from '"ticket_id"\s*:\s*"([0-9]+)"'))::bigint AS fd_id,
    (regexp_match(c.raw_body, '"description"\s*:\s*"((?:[^"\\]|\\.)*)"', ''))[1] AS raw_desc,
    c.received_at
  FROM public._freshdesk_capture c
  WHERE c.raw_body ~ '"description"\s*:\s*"[^"]'
  ORDER BY (c.raw_body)::text, c.received_at DESC
),
decoded AS (
  SELECT
    fd_id,
    NULLIF(
      replace(
        replace(
          replace(
            replace(
              replace(raw_desc, '\"', '"'),
              '\n', E'\n'
            ),
            '\r', E'\r'
          ),
          '\t', E'\t'
        ),
        '\\', '\'
      ),
      ''
    ) AS clean_desc
  FROM latest_capture
  WHERE fd_id IS NOT NULL
)
UPDATE aa_04_support.tickets t
SET description = d.clean_desc
FROM decoded d
WHERE t.freshdesk_ticket_id = d.fd_id
  AND t.description IS NULL
  AND d.clean_desc IS NOT NULL;
