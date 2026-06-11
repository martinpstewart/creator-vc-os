-- Tickets: date-range filter + per-window summary stats for the new
-- "Generate summary" feature on /tickets.
--
-- 1. tickets_list gains p_from / p_to (filter on created_at). Drop +
--    recreate because the return type can't change via OR REPLACE.
-- 2. tickets_created_timeline_range: one row per day in the window
--    (count = 0 on quiet days so the chart has no gaps).
-- 3. get_tickets_summary_stats: precomputes the theme counts + sample
--    subjects + truncated descriptions that the new tickets-summary
--    edge function hands to Claude. SQL-side keyword tallies keep
--    the numbers exact (LLM is only writing prose).

DROP FUNCTION IF EXISTS public.tickets_list(text, text, uuid, integer, integer);

CREATE FUNCTION public.tickets_list(
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_assignee uuid DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS TABLE(
  id bigint, ticket_number text, subject text, status text, priority text,
  customer_id bigint, customer_name text, customer_email text,
  order_ref text, order_source text,
  assigned_to uuid, assigned_to_email text, assigned_to_name text,
  last_actioned_by_email text, last_actioned_by_name text,
  last_actioned_at timestamptz, created_at timestamptz,
  total_count bigint,
  freshdesk_ticket_id bigint, freshdesk_url text,
  source text, agent_name text, campaign_id bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, aa_04_support, aa_02_crm, auth
AS $$
DECLARE v_off int := (greatest(p_page,1)-1) * greatest(p_page_size,1);
BEGIN
  IF public.current_app_role() IS NULL THEN RAISE EXCEPTION 'forbidden: staff only'; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT t.*,
           trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')) AS cname,
           c.email AS cemail
    FROM aa_04_support.tickets t
    LEFT JOIN aa_02_crm.customers c ON c.id = t.customer_id
    WHERE (p_status   IS NULL OR t.status = p_status)
      AND (p_assignee IS NULL OR t.assigned_to = p_assignee)
      AND (p_from IS NULL OR t.created_at >= p_from)
      AND (p_to   IS NULL OR t.created_at <  p_to)
      AND (p_search   IS NULL OR p_search = '' OR
             t.ticket_number ilike '%'||p_search||'%' OR
             t.subject       ilike '%'||p_search||'%' OR
             coalesce(c.email,'')           ilike '%'||p_search||'%' OR
             coalesce(t.requester_email,'') ilike '%'||p_search||'%' OR
             trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')) ilike '%'||p_search||'%')
  ),
  counted AS (SELECT count(*) AS n FROM base)
  SELECT b.id, b.ticket_number, b.subject, b.status, b.priority,
         b.customer_id, nullif(b.cname,''), b.cemail, b.order_ref, b.order_source,
         b.assigned_to, ua.email::text,
         coalesce(nullif(trim(ra.display_name),''), ua.email::text),
         ul.email::text, coalesce(nullif(trim(rl.display_name),''), ul.email::text),
         b.last_actioned_at, b.created_at, counted.n,
         b.freshdesk_ticket_id,
         CASE WHEN b.freshdesk_ticket_id IS NOT NULL
              THEN 'https://creatorvc.freshdesk.com/a/tickets/'||b.freshdesk_ticket_id END,
         b.source, b.agent_name, b.campaign_id
  FROM base b
  LEFT JOIN auth.users ua ON ua.id = b.assigned_to
  LEFT JOIN public.app_user_roles ra ON ra.user_id = b.assigned_to
  LEFT JOIN auth.users ul ON ul.id = b.last_actioned_by
  LEFT JOIN public.app_user_roles rl ON rl.user_id = b.last_actioned_by
  CROSS JOIN counted
  ORDER BY b.last_actioned_at DESC NULLS LAST, b.created_at DESC
  OFFSET v_off LIMIT greatest(p_page_size,1);
END $$;

REVOKE ALL ON FUNCTION public.tickets_list(text, text, uuid, integer, integer, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tickets_list(text, text, uuid, integer, integer, timestamptz, timestamptz) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.tickets_created_timeline_range(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS TABLE(date date, count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, aa_04_support
AS $$
  WITH days AS (
    SELECT generate_series(
      date_trunc('day', p_from)::date,
      date_trunc('day', p_to - interval '1 day')::date,
      interval '1 day'
    )::date AS d
  ),
  daily AS (
    SELECT created_at::date AS d, count(*)::int AS c
    FROM aa_04_support.tickets
    WHERE created_at >= p_from AND created_at < p_to
    GROUP BY 1
  )
  SELECT days.d, coalesce(daily.c, 0) AS count
  FROM days LEFT JOIN daily ON daily.d = days.d
  ORDER BY days.d;
$$;

REVOKE ALL ON FUNCTION public.tickets_created_timeline_range(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tickets_created_timeline_range(timestamptz, timestamptz) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_tickets_summary_stats(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, aa_04_support
AS $$
DECLARE
  v_total int;
  v_themes jsonb;
  v_subjects jsonb;
  v_descs jsonb;
BEGIN
  IF public.current_app_role() IS NULL THEN
    RAISE EXCEPTION 'forbidden: staff only' USING errcode = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to THEN
    RAISE EXCEPTION 'invalid date range' USING errcode = '22023';
  END IF;

  WITH recent AS (
    SELECT id, ticket_number, subject, description,
           coalesce(subject,'') || ' ' || coalesce(description,'') AS txt
    FROM aa_04_support.tickets
    WHERE created_at >= p_from AND created_at < p_to
  ),
  theme_counts AS (
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE txt ILIKE '%shipping%' AND (txt ILIKE '%pay%' OR txt ILIKE '%charge%')) AS shipping_payment,
      count(*) FILTER (WHERE txt ILIKE '%address%' OR txt ILIKE '%move%' OR txt ILIKE '%moved%') AS address_change,
      count(*) FILTER (WHERE txt ILIKE '%track%' OR txt ILIKE '%where is%' OR txt ILIKE '%shipped%' OR txt ILIKE '%delivery%') AS where_is_order,
      count(*) FILTER (WHERE txt ILIKE '%digital%' OR txt ILIKE '%download%' OR txt ILIKE '%stream%' OR txt ILIKE '%link%') AS digital_access,
      count(*) FILTER (WHERE txt ILIKE '%upgrade%' OR txt ILIKE '%upsell%' OR txt ILIKE '%add%on%' OR txt ILIKE '%producer tier%') AS upgrade_upsell,
      count(*) FILTER (WHERE txt ILIKE '%damaged%' OR txt ILIKE '%broken%' OR txt ILIKE '%defective%' OR txt ILIKE '%scratch%') AS damaged,
      count(*) FILTER (WHERE txt ILIKE '%missing%' OR txt ILIKE '%never arrived%' OR txt ILIKE '%didn''t receive%' OR txt ILIKE '%did not receive%' OR txt ILIKE '%lost%') AS never_arrived,
      count(*) FILTER (WHERE txt ILIKE '%double%charge%' OR txt ILIKE '%charged twice%' OR txt ILIKE '%duplicate%') AS double_charge,
      count(*) FILTER (WHERE txt ILIKE '%refund%') AS refund,
      count(*) FILTER (WHERE txt ILIKE '%cancel%') AS cancellation,
      count(*) FILTER (WHERE txt ILIKE '%wrong%' OR txt ILIKE '%incorrect%') AS wrong_item
    FROM recent
  ),
  top_subjects AS (
    SELECT jsonb_agg(jsonb_build_object('subject', subject, 'n', n) ORDER BY n DESC) AS j
    FROM (
      SELECT subject, count(*) AS n
      FROM recent
      WHERE subject IS NOT NULL AND subject <> ''
      GROUP BY subject
      ORDER BY n DESC
      LIMIT 12
    ) s
  ),
  sample_descs AS (
    SELECT jsonb_agg(jsonb_build_object(
      'ticket_number', ticket_number,
      'subject', subject,
      'description_excerpt', left(description, 500)
    )) AS j
    FROM (
      SELECT ticket_number, subject, description
      FROM recent
      WHERE description IS NOT NULL AND length(description) > 30
      ORDER BY random()
      LIMIT 30
    ) d
  )
  SELECT
    tc.total,
    jsonb_build_object(
      'shipping_payment_confusion', tc.shipping_payment,
      'address_change',             tc.address_change,
      'where_is_order',             tc.where_is_order,
      'digital_access',             tc.digital_access,
      'upgrade_upsell',             tc.upgrade_upsell,
      'damaged',                    tc.damaged,
      'never_arrived',              tc.never_arrived,
      'double_charge',              tc.double_charge,
      'refund',                     tc.refund,
      'cancellation',               tc.cancellation,
      'wrong_item',                 tc.wrong_item
    ),
    coalesce(ts.j, '[]'::jsonb),
    coalesce(sd.j, '[]'::jsonb)
  INTO v_total, v_themes, v_subjects, v_descs
  FROM theme_counts tc, top_subjects ts, sample_descs sd;

  RETURN jsonb_build_object(
    'total_tickets', v_total,
    'from',          p_from,
    'to',            p_to,
    'themes',        v_themes,
    'top_subjects',  v_subjects,
    'sample_descriptions', v_descs
  );
END $$;

REVOKE ALL ON FUNCTION public.get_tickets_summary_stats(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tickets_summary_stats(timestamptz, timestamptz) TO anon, authenticated;
