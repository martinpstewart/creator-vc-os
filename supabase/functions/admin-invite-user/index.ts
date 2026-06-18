// admin-invite-user — sends a magic-link invite via Supabase Auth Admin API
// and assigns the new user a role row in app_user_roles. Service-role only
// lives inside this function; the Next.js side stays clean.
//
// Auth model: the platform verifies the caller's JWT (verify_jwt = true)
// and we additionally check that the caller's app_user_roles row is
// 'admin' before doing anything. Non-admins get 403.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405)
  }

  // 1. Auth — extract user from JWT in Authorization header.
  const authHeader = req.headers.get('authorization') ?? ''
  const accessToken = authHeader.replace(/^Bearer\s+/i, '')
  if (!accessToken) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }
  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(accessToken)
  if (authError || !user) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  // 2. Admin check — caller must have role='admin' in app_user_roles.
  //    Service-role bypasses RLS, so we can read any user's row.
  const { data: roleRow, error: roleErr } = await admin
    .from('app_user_roles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (roleErr) {
    console.error('[admin-invite-user] role lookup failed', roleErr)
    return jsonResponse({ error: 'role lookup failed' }, 500)
  }
  if (roleRow?.role !== 'admin') {
    return jsonResponse({ error: 'forbidden: admin only' }, 403)
  }

  // 3. Body — { email, role, displayName?, redirectTo? }.
  let body: {
    email?: string
    role?: string
    displayName?: string
    redirectTo?: string
  } = {}
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid JSON body' }, 400)
  }
  const email = String(body.email ?? '').trim().toLowerCase()
  const role = String(body.role ?? '').trim()
  const displayName = (body.displayName ?? '').trim() || null
  const redirectTo = body.redirectTo ? String(body.redirectTo) : undefined

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: 'valid email required' }, 400)
  }
  if (!['admin', 'team', 'support'].includes(role)) {
    return jsonResponse({ error: 'role must be admin, team or support' }, 400)
  }

  // 4. Invite via Auth Admin API. Sends the magic-link email; if the
  //    user already exists, returns 422 from Supabase.
  const { data: inviteData, error: inviteErr } =
    await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
    } as any)
  if (inviteErr || !inviteData?.user) {
    return jsonResponse(
      { error: inviteErr?.message ?? 'invite failed' },
      400,
    )
  }

  // 5. Persist the role row + display name. Upsert so re-inviting a user
  //    (e.g. you revoked them earlier) just re-creates the membership.
  const { error: roleUpsertErr } = await admin
    .from('app_user_roles')
    .upsert(
      { user_id: inviteData.user.id, role, display_name: displayName },
      { onConflict: 'user_id' },
    )
  if (roleUpsertErr) {
    console.error('[admin-invite-user] role upsert failed', roleUpsertErr)
    return jsonResponse(
      { error: 'role assign failed: ' + roleUpsertErr.message },
      500,
    )
  }

  return jsonResponse({
    user_id: inviteData.user.id,
    email: inviteData.user.email,
    role,
    display_name: displayName,
  })
})
