import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { ACCESS, FIRST_ALLOWED, normaliseRole, screenForPath, type Role } from '@/lib/auth'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Routes reachable without a session:
  //   /login              — sign in
  //   /forgot-password    — request a reset email
  //   /reset-password     — land here after clicking the email link;
  //                         Supabase establishes a recovery session
  //                         client-side from the URL hash, so this
  //                         route must NOT bounce unauthenticated
  //                         users away or the recovery flow can't
  //                         complete.
  const PUBLIC_AUTH_PATHS = new Set(['/login', '/forgot-password', '/reset-password'])
  const isPublicAuthPage = PUBLIC_AUTH_PATHS.has(request.nextUrl.pathname)
  const isLoginPage = request.nextUrl.pathname === '/login'
  const isForgotPage = request.nextUrl.pathname === '/forgot-password'

  let user: { id: string } | null = null
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('auth getUser timeout')), 3000)
    )
    const result = await Promise.race([supabase.auth.getUser(), timeout])
    user = result.data.user
  } catch (e) {
    console.error('[middleware] auth check failed', e)
    // On auth failure, treat as unauthenticated but don't bounce away
    // from public auth routes (avoids redirect loops if Supabase is down).
    if (isPublicAuthPage) return supabaseResponse
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (!user && !isPublicAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // A signed-in user landing on /login or /forgot-password should be
  // sent home. /reset-password is special: a recovery session counts
  // as signed in, but the user is mid-flow and must be allowed to finish.
  if (user && (isLoginPage || isForgotPage)) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // Role-aware route guard. Looks up the caller's row in app_user_roles
  // (RLS scopes this to their own row), maps the URL to a Screen, and
  // 302s them to their FIRST_ALLOWED screen if they can't see this one.
  //
  // Cost: one extra PostgREST hop per protected navigation. Acceptable
  // for an internal 4-user CRM; revisit with a signed-role cookie if it
  // ever shows up on traces.
  if (user && !isPublicAuthPage) {
    const screen = screenForPath(request.nextUrl.pathname)
    if (screen) {
      let role: Role = 'support'
      try {
        const lookup = supabase
          .from('app_user_roles')
          .select('role')
          .eq('user_id', user.id)
          .maybeSingle()
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('role lookup timeout')), 2000)
        )
        const result = (await Promise.race([lookup, timeout])) as {
          data: { role: string } | null
        }
        role = normaliseRole(result.data?.role)
      } catch (e) {
        // Fall back to 'support' (already set) — the least-privileged tier
        // is the safest assumption when the lookup is flaky.
        console.error('[middleware] role lookup failed', e)
      }

      if (!ACCESS[role].includes(screen)) {
        const url = request.nextUrl.clone()
        url.pathname = FIRST_ALLOWED[role]
        url.search = ''
        return NextResponse.redirect(url)
      }
    }
  }

  return supabaseResponse
}

export const config = {
  // `p/` matches the public landing-page routes which must be reachable
  // by unauthenticated visitors. `api/` was already excluded.
  matcher: ['/((?!api|_next/static|_next/image|p/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
