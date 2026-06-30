'use client'

// User lands here after clicking the recovery link in their email.
// Supabase's browser client picks up the recovery token from the URL
// hash on mount and establishes a temporary "recovery" session that
// is only allowed to call auth.updateUser({ password }). Once the
// password is set, the recovery session becomes a normal session and
// we send the user home.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import Logo from '@/components/Logo'

const MIN_LENGTH = 8

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)

  // Wait for Supabase to surface the recovery session before showing the
  // form — protects against users navigating here directly without a
  // valid recovery token.
  useEffect(() => {
    const supabase = createClient()
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setReady(true)
      }
    })
    // If the page is loaded with an already-active session (e.g. the
    // hash was processed before this listener attached), reveal the form
    // immediately.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    // If this user was created via magic-link invite and never set a
    // password, the recovery flow doubles as the first-time setup —
    // mark the gate as cleared so the middleware stops sending them
    // back to /profile.
    const { error: markErr } = await supabase.rpc('user_mark_password_set')
    if (markErr) console.warn('[ResetPassword] mark password set failed', markErr.message)
    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <Logo size="lg" />
        </div>

        <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
          <div>
            <h1 className="text-sm font-semibold text-white">Choose a new password</h1>
            <p className="text-xs text-zinc-500 mt-1">
              {ready
                ? `At least ${MIN_LENGTH} characters.`
                : 'Verifying your reset link…'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              disabled={!ready}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              disabled={!ready}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !ready}
            className="w-full bg-white hover:bg-zinc-100 disabled:opacity-50 text-zinc-900 font-medium text-sm rounded-lg py-2.5 transition-colors"
          >
            {loading ? 'Updating…' : 'Update password'}
          </button>

          <Link
            href="/login"
            className="block text-center text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ← Back to sign in
          </Link>
        </form>
      </div>
    </div>
  )
}
