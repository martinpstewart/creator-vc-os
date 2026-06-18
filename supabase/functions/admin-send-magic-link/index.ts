// admin-send-magic-link — generates a fresh magic-link email for an
// EXISTING user and triggers Supabase to send it. Pairs with the per-row
// "Send link" button on /users. Useful when a teammate's prior magic link
// expired (24h TTL) or their initial invite email got lost in spam.
//
// Different from admin-invite-user: that one creates a NEW auth.users row
// and a role assignment. This one assumes the user already exists and
// just re-issues the sign-in link.
//
// Auth model: identical to admin-invite-user — the platform verifies the
// caller's JWT (verify_jwt = true) and we additionally require the
// caller to have role='admin' in app_user_roles. Non-admins get 403.

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

  // 1. Auth — extract caller from JWT.
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

  // 2. Admin check — only admins can issue magic links to other users.
  const { data: roleRow, error: roleErr } = await admin
    .from('app_user_roles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (roleErr) {
    console.error('[admin-send-magic-link] role lookup failed', roleErr)
    return jsonResponse({ error: 'role lookup failed' }, 500)
  }
  if (roleRow?.role !== 'admin') {
    return jsonResponse({ error: 'forbidden: admin only' }, 403)
  }

  // 3. Body — { email, redirectTo? }.
  let body: { email?: string; redirectTo?: string } = {}
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid JSON body' }, 400)
  }
  const email = String(body.email ?? '').trim().toLowerCase()
  const redirectTo = body.redirectTo ? String(body.redirectTo) : undefined

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: 'valid email required' }, 400)
  }

  // 4. Send magic link via signInWithOtp. This is the only Auth API that
  //    BOTH generates the link AND ships it through the project's
  //    configured mailer — `auth.admin.generateLink` only RETURNS the
  //    link (which we'd then need to email ourselves). shouldCreateUser
  //    is false because the row already exists in auth.users; if the
  //    email isn't found, this returns an error rather than silently
  //    creating a phantom user.
  const { error: otpErr } = await admin.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: redirectTo,
    },
  })
  if (otpErr) {
    console.error('[admin-send-magic-link] signInWithOtp failed', otpErr)
    return jsonResponse(
      { error: otpErr.message ?? 'magic link send failed' },
      400,
    )
  }

  return jsonResponse({
    email,
    sent_at: new Date().toISOString(),
  })
})
