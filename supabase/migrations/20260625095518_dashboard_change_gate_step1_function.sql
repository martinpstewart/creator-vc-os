-- Gated dashboard refresh: skip the expensive rebuild when no order activity
-- has occurred since the last build, the snapshot is <2h old, and the date
-- hasn't rolled over. Otherwise rebuild via the existing refresh and advance
-- the watermark. Returns true if it rebuilt, false if it skipped.
CREATE OR REPLACE FUNCTION public.refresh_dashboard_snapshot_gated()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','public','aa_02_crm'
AS $function$
DECLARE
  v_last_hwm   timestamptz;
  v_cur_hwm    timestamptz;
  v_last_built timestamptz;
BEGIN
  SELECT watermark INTO v_last_hwm FROM aa_02_crm.snapshot_watermarks WHERE name = 'dashboard';
  IF v_last_hwm IS NULL THEN v_last_hwm := '-infinity'::timestamptz; END IF;

  SELECT max(updated_at) INTO v_cur_hwm FROM aa_02_crm.customers;
  SELECT refreshed_at    INTO v_last_built FROM aa_02_crm.dashboard_snapshot WHERE id = 1;

  -- Skip only if: no new activity AND fresh enough AND same day.
  IF v_cur_hwm IS NOT DISTINCT FROM v_last_hwm
     AND v_last_built IS NOT NULL
     AND v_last_built > now() - interval '2 hours'
     AND v_last_built::date = current_date THEN
    RETURN false;
  END IF;

  PERFORM public.refresh_dashboard_snapshot();

  INSERT INTO aa_02_crm.snapshot_watermarks(name, watermark)
  VALUES ('dashboard', coalesce(v_cur_hwm, '-infinity'::timestamptz))
  ON CONFLICT (name) DO UPDATE SET watermark = excluded.watermark;
  RETURN true;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.refresh_dashboard_snapshot_gated() TO anon, authenticated;

-- Seed the watermark to the current activity high-water mark so the gate
-- starts from a known-current baseline.
INSERT INTO aa_02_crm.snapshot_watermarks(name, watermark)
SELECT 'dashboard', coalesce(max(updated_at), '-infinity'::timestamptz)
FROM aa_02_crm.customers
ON CONFLICT (name) DO UPDATE SET watermark = excluded.watermark;
