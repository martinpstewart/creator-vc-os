'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-browser'
import { normaliseRole, type Role } from '@/lib/auth'

type AuthValue = {
  user: User | null
  role: Role
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

// Hydrated with the server-rendered user + role so consumers (Sidebar /
// BottomNav) get the right nav on first paint — no flash of admin links
// for a team/support user. After hydration we subscribe to auth changes
// so a sign-out elsewhere or a token refresh stays in sync.
export function AuthProvider({
  children,
  initialUser,
  initialRole,
}: {
  children: React.ReactNode
  initialUser: User | null
  initialRole: Role
}) {
  const [user, setUser] = useState<User | null>(initialUser)
  const [role, setRole] = useState<Role>(initialRole)

  useEffect(() => {
    const supabase = createClient()
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      setUser(nextUser)
      if (!nextUser) {
        // Reset to the safest tier — middleware will bounce them to /login
        // before any role-gated screen renders.
        setRole('support')
        return
      }
      // CRITICAL: do NOT await any supabase.* call inside this callback.
      // The GoTrue auth lock is held while this runs; any client call
      // (.from / .rpc / .auth.getSession) tries to re-acquire that same
      // lock and deadlocks, hanging every subsequent Supabase request on
      // the page. setTimeout(0) defers the work until the lock releases.
      // https://supabase.com/docs/reference/javascript/auth-onauthstatechange
      setTimeout(async () => {
        const { data, error } = await supabase
          .from('app_user_roles')
          .select('role')
          .eq('user_id', nextUser.id)
          .maybeSingle()
        if (error) {
          console.warn('[AuthProvider] role lookup failed', error.message)
        }
        setRole(normaliseRole(data?.role))
      }, 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const signOut = useCallback(async () => {
    // Sign out server-side — the cookie-aware server client writes the
    // Set-Cookie deletion headers into the response, which a browser-only
    // signOut() can't do for HttpOnly cookies. Without this, the next
    // request still carries a valid session and middleware bounces back
    // into the app instead of /login.
    try {
      await fetch('/api/auth/signout', { method: 'POST' })
    } catch (e) {
      console.error('[signOut] server signout failed', e)
    }
    // Hard navigate so middleware re-runs against the cleared cookies
    // and any in-memory client state (this provider, query caches) is
    // dropped on the fresh page load.
    window.location.href = '/login'
  }, [])

  return (
    <AuthContext.Provider value={{ user, role, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
