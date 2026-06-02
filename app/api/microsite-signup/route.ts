import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

// Public form-submit endpoint for landing pages hosted at /p/[slug].
// Accepts JSON { slug, fields: { email, first_name?, last_name?, phone? }, utm? }
// Calls marketing_record_signup which upserts a contact + writes a
// microsite_signups row + audit trail in one transaction.

type SignupBody = {
  slug?: string
  fields?: Record<string, unknown>
  utm?: Record<string, unknown>
}

const MAX_FIELD_LEN = 500

function clamp(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, MAX_FIELD_LEN)
  return t === '' ? null : t
}

export async function POST(req: NextRequest) {
  let body: SignupBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }

  const slug = clamp(body.slug)
  if (!slug) {
    return NextResponse.json({ ok: false, error: 'slug required' }, { status: 400 })
  }
  // Whitelist field keys so visitors can't smuggle arbitrary jsonb in
  // and bloat the form_data column. Drop the rest silently.
  const allowed = ['email', 'first_name', 'last_name', 'phone'] as const
  const rawFields = body.fields ?? {}
  const fields: Record<string, string> = {}
  for (const key of allowed) {
    const v = clamp(rawFields[key])
    if (v) fields[key] = v
  }

  if (!fields.email) {
    return NextResponse.json({ ok: false, error: 'email required' }, { status: 400 })
  }

  const utm: Record<string, string> = {}
  for (const key of ['source', 'medium', 'campaign', 'term', 'content'] as const) {
    const v = clamp(body.utm?.[key])
    if (v) utm[key] = v
  }

  // Read IP + user agent + country off the request. Vercel sets x-forwarded-for
  // and resolves x-vercel-ip-country for free at the edge.
  const fwd = req.headers.get('x-forwarded-for') ?? ''
  const ip = fwd.split(',')[0]?.trim() || null
  const ua = req.headers.get('user-agent') ?? null
  const country = req.headers.get('x-vercel-ip-country') ?? null

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data, error } = await supabase.rpc('marketing_record_signup', {
    p_slug: slug,
    p_fields: fields,
    p_utm: utm,
    p_ip: ip,
    p_user_agent: ua,
    p_country_code: country,
  })

  if (error) {
    // Translate the "no published microsite for slug" raise into a 404.
    if (error.code === 'P0001' && error.message.includes('no published microsite')) {
      return NextResponse.json({ ok: false, error: 'page not found' }, { status: 404 })
    }
    if (error.code === '22023' || error.message.toLowerCase().includes('invalid email')) {
      return NextResponse.json({ ok: false, error: 'invalid email' }, { status: 400 })
    }
    console.error('[microsite-signup] rpc error', error)
    return NextResponse.json({ ok: false, error: 'submission failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, signup_id: data })
}
