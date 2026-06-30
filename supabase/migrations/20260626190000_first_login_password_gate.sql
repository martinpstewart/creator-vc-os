-- Force invited users to set a password before they reach the rest of
-- the app. New users are created via admin-invite-user which calls
-- Supabase's inviteUserByEmail — no password is set, they land in the
-- app authenticated via the magic link. Without this gate they could
-- stay password-less forever and sign in via repeated magic links.
--
-- Mechanism:
--   - app_user_roles.password_set_at: timestamptz, default NULL
--   - middleware redirects anyone with NULL password_set_at to /profile
--     except when they're already on /profile or /reset-password
--   - profile page + reset-password page both call user_mark_password_set
--     after auth.updateUser({password}) succeeds
--
-- Backfill: existing users in app_user_roles all have a password set
-- (every active human in the system signed in with one before this
-- migration). Stamp them so they aren't locked out.

alter table public.app_user_roles
  add column if not exists password_set_at timestamptz;

-- Backfill: anyone whose auth.users row has encrypted_password set
-- counts as "password already set". We deliberately use auth.users as
-- the source of truth instead of just-stamping-all-rows so a row that
-- somehow exists without a password (test fixture, manual insert)
-- doesn't get wrongly flagged.
update public.app_user_roles r
   set password_set_at = now()
  from auth.users u
 where u.id = r.user_id
   and u.encrypted_password is not null
   and r.password_set_at is null;

-- Caller-scoped RPC. Triggered by the password-update success path on
-- both /profile and /reset-password.
create or replace function public.user_mark_password_set()
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.app_user_roles
     set password_set_at = coalesce(password_set_at, now())
   where user_id = auth.uid();
$$;
grant execute on function public.user_mark_password_set() to authenticated;
