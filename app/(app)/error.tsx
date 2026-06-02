'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// Sessionstorage key prefix so the auto-retry only fires once per error
// per session. Without it a hard-broken page would retry-loop forever.
// The digest is the per-throw fingerprint Next.js attaches, so different
// errors each get their own one-shot retry budget.
const RETRY_KEY = 'app-error-retried:'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  const [retrying, setRetrying] = useState(false)
  const autoRetriedRef = useRef(false)

  useEffect(() => {
    console.error('[app] route error', error)
  }, [error])

  // Auto-retry once per (digest, session). The typical cause is a
  // transient Vercel↔Supabase blip the data layer's withRetry didn't
  // recover from — one fresh page-render usually fixes it without ever
  // showing the user the boundary card.
  useEffect(() => {
    if (autoRetriedRef.current) return
    autoRetriedRef.current = true

    const key = RETRY_KEY + (error.digest ?? 'no-digest')
    let alreadyRetried = false
    try {
      alreadyRetried = sessionStorage.getItem(key) === '1'
    } catch {
      // sessionStorage can throw in private mode / SSR — treat as "skip".
      return
    }
    if (alreadyRetried) return

    try {
      sessionStorage.setItem(key, '1')
    } catch {
      return
    }
    setRetrying(true)
    router.refresh()
    reset()
  }, [error.digest, reset, router])

  function manualRetry() {
    setRetrying(true)
    router.refresh()
    reset()
  }

  // While the auto-retry is in flight, render a neutral placeholder so
  // the boundary card doesn't flash before the refresh swaps the tree.
  if (retrying) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-zinc-500">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center">
        <h1 className="text-base font-semibold text-white mb-2">Something went wrong</h1>
        <p className="text-sm text-zinc-400 mb-4">
          We couldn&apos;t load this page. This is usually temporary.
        </p>
        {error.digest && (
          <p className="text-xs text-zinc-600 font-mono mb-4">ref: {error.digest}</p>
        )}
        <button
          onClick={manualRetry}
          disabled={retrying}
          className="px-4 py-2 text-sm rounded-md bg-white text-zinc-900 hover:bg-zinc-200 disabled:opacity-50 transition-colors font-medium"
        >
          {retrying ? 'Retrying…' : 'Try again'}
        </button>
      </div>
    </div>
  )
}
