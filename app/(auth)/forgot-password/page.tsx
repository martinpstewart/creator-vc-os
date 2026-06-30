'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import Logo from '@/components/Logo'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    setSent(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <Logo size="lg" />
        </div>

        {sent ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-3">
            <h1 className="text-sm font-semibold text-white">Check your email</h1>
            <p className="text-xs text-zinc-400 leading-relaxed">
              If an account exists for <span className="text-zinc-200">{email}</span>, we&rsquo;ve sent a link to reset your password. Click it within 60 minutes.
            </p>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Didn&rsquo;t arrive? Check spam, or{' '}
              <button
                type="button"
                onClick={() => setSent(false)}
                className="text-zinc-300 underline decoration-zinc-700 underline-offset-2 hover:text-white"
              >
                try a different email
              </button>
              .
            </p>
            <div className="pt-2">
              <Link
                href="/login"
                className="block w-full bg-white hover:bg-zinc-100 text-zinc-900 font-medium text-sm rounded-lg py-2.5 text-center transition-colors"
              >
                Back to sign in
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
            <div>
              <h1 className="text-sm font-semibold text-white">Forgot your password?</h1>
              <p className="text-xs text-zinc-500 mt-1">Enter your email and we&rsquo;ll send a reset link.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                placeholder="you@example.com"
              />
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-white hover:bg-zinc-100 disabled:opacity-50 text-zinc-900 font-medium text-sm rounded-lg py-2.5 transition-colors"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>

            <Link
              href="/login"
              className="block text-center text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              ← Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  )
}
