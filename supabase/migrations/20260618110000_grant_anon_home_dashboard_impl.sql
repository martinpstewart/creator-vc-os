-- Grant EXECUTE on home_dashboard_impl to anon + authenticated.
-- The Next.js cached dashboard wrapper (getHomeDashboardCached in
-- lib/supabase.ts) calls home_dashboard_impl via the stateless
-- anon-key client - that's the only way to wrap an RPC in
-- next/cache's unstable_cache (cookie-aware clients can't be
-- cached). The middleware enforces admin-only access to '/' at
-- the page boundary, so the un-gated impl being callable doesn't
-- widen the security surface beyond what the gated wrapper allowed.
GRANT EXECUTE ON FUNCTION public.home_dashboard_impl() TO anon, authenticated;
