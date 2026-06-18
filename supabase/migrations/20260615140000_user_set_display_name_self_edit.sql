-- Self-edit RPC: a user updates their own display_name from the
-- new /profile screen. Mirrors admin_set_display_name's logic but
-- targets auth.uid() so callers can't poke at someone else's row.
-- Doesn't insert if no row exists (a user who has no app_user_roles
-- row is anonymously authenticated; shouldn't be able to assign
-- themselves a role through this surface).
CREATE OR REPLACE FUNCTION public.user_set_display_name(p_display_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_normalised text;
  v_updated int;
begin
  if v_caller is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_normalised := nullif(trim(coalesce(p_display_name, '')), '');

  update public.app_user_roles
     set display_name = v_normalised
   where user_id = v_caller;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'no role row for this user' using errcode = '22023';
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION public.user_set_display_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_set_display_name(text) TO authenticated;
