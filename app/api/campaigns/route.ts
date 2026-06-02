import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase-server'

// Create a campaign. Server-side because:
//   1. The create_campaign RPC requires auth.uid() — only the cookie-
//      aware SSR client carries the user session into PostgREST.
//   2. getCampaigns() in lib/supabase.ts is wrapped in unstable_cache
//      with a 5-minute TTL and the 'campaigns' tag. Without busting
//      that tag here, a freshly-inserted campaign wouldn't show on the
//      list page until the cache expired — confusing UX.
//
// The RPC itself enforces the admin-or-team role check, so this route
// doesn't need a redundant gate (and shouldn't: keeping the trust
// boundary inside the DB function means it can't be bypassed by hitting
// the endpoint directly).
export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'expected JSON object' }, { status: 400 })
  }
  const { name, legacyCode } = body as {
    name?: unknown
    legacyCode?: unknown
  }
  if (typeof name !== 'string' || typeof legacyCode !== 'string') {
    return NextResponse.json(
      { error: 'name and legacyCode are required strings' },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_campaign', {
    p_name: name,
    p_legacy_code: legacyCode,
  })
  if (error) {
    // Map the well-known Postgres error codes raised inside the RPC to
    // an HTTP status. Everything else falls through as a 500.
    //   42501 → forbidden (caller not admin/team, or unauthenticated)
    //   22023 → invalid parameter (empty name / legacy_code)
    //   23505 → unique violation (legacy_code duplicates an existing row)
    const code = error.code
    const status =
      code === '42501' ? 403 :
      code === '22023' ? 400 :
      code === '23505' ? 409 :
      500
    return NextResponse.json({ error: error.message }, { status })
  }

  // Bust the campaigns list cache so the new row appears immediately.
  // Next 16 split revalidateTag into two flavours:
  //   - revalidateTag(tag, 'max')      → stale-while-revalidate
  //   - revalidateTag(tag, {expire:0}) → immediate expiration
  // We need immediate here — the user just submitted and expects to
  // see the new campaign on the next render. updateTag() would do the
  // same thing but is restricted to Server Actions, which the rest of
  // the app doesn't use, so we stay on the Route Handler path.
  // Stats / historic tags don't need busting — a brand-new campaign has
  // no orders, so the stats RPC wouldn't return it anyway.
  revalidateTag('campaigns', { expire: 0 })

  // RPC returns a single-row table — surface the inserted row to the
  // client in case it wants to navigate to the new campaign's detail
  // page directly.
  const row = Array.isArray(data) && data.length > 0 ? data[0] : null
  return NextResponse.json({ campaign: row })
}
