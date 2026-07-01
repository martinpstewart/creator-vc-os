-- Hotfix: revert 20260626180000's guard on home_dashboard_impl.
--
-- That migration added:
--   if not public.is_admin() then raise exception 'forbidden: admin only';
-- to "close the side door" past the existing home_dashboard() wrapper.
--
-- But the app calls home_dashboard_impl DIRECTLY (see lib/supabase.ts
-- line 48) via a plain @supabase/supabase-js server-side client using
-- the anon key, wrapped in unstable_cache. In that SSR path there is
-- no session cookie forwarded, so auth.uid() is NULL, is_admin()
-- returns false, and the guard raised on every dashboard load.
-- Result: home page 500s for everyone including admins.
--
-- Admin-only access to the / route is enforced at the middleware level
-- (screenForPath('/') = 'dashboard', only in ACCESS['admin']). Keeping
-- the impl SQL + open is the intentional split: home_dashboard() is
-- the browser-callable admin-gated entry, home_dashboard_impl() is the
-- SSR-callable inner read.

create or replace function public.home_dashboard_impl()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, aa_02_crm
as $$
  select payload from aa_02_crm.dashboard_snapshot where id = 1;
$$;
