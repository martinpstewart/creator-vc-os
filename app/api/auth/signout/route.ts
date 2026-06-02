import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

// Server-side sign-out. Required because @supabase/ssr writes auth
// cookies with HttpOnly + path attributes that the browser client can't
// reliably clear from document.cookie — only proper Set-Cookie response
// headers will do it. The middleware matcher excludes /api/* so this
// route runs cleanly without an auth bounce.
export async function POST() {
  const supabase = await createClient()
  // signOut on the cookie-aware server client writes the deletion
  // cookies into the response via the setAll handler in supabase-server.
  await supabase.auth.signOut()
  return NextResponse.json({ ok: true })
}
