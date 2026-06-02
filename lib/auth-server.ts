import { cache } from 'react'
import { createClient } from './supabase-server'
import { withRetry } from './supabase'
import { normaliseRole, type Role } from './auth'

// Per-request cached role lookup. Several server components on a single
// page (layout + the page itself + any nested server components) all call
// this; React's cache() dedupes them into one PostgREST hop.
//
// Returns 'support' (the least-privileged tier) for unauthenticated
// callers or when the role row is missing — middleware will redirect
// non-auth users before any page that uses this renders, so this fallback
// is for the genuinely-rare row-missing case.
//
// Wrapped in withRetry — this runs on every (app)/* request via the
// layout + any page that gates revenue, and a single Vercel→Supabase
// blip would otherwise throw the whole route into the error boundary.
export const getCurrentRole = cache(async (): Promise<Role> =>
  withRetry(async () => {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return 'support'

    const { data, error } = await supabase
      .from('app_user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) {
      console.warn('[getCurrentRole] lookup failed', error.message)
      return 'support'
    }
    return normaliseRole(data?.role)
  }, 'getCurrentRole'),
)
