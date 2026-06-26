-- Persist the result rows alongside the metadata so tapping a recent
-- question in the Ask screen can show what it returned LAST TIME
-- without re-running the AI / DB query. Costs nothing in the read
-- path: same RLS policy ("user_id = auth.uid()") gates the new
-- columns; the existing nl_query_log SELECT just picks them up.
-- Capped to 100 rows at edge-fn write time so the jsonb blob stays
-- bounded (~50KB per query worst case).

ALTER TABLE public.nl_query_log
  ADD COLUMN IF NOT EXISTS result_columns   text[],
  ADD COLUMN IF NOT EXISTS result_rows      jsonb,
  ADD COLUMN IF NOT EXISTS result_truncated boolean;
