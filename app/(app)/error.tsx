'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    console.error('[app] route error', error)
  }, [error])

  function manualRetry() {
    setRetrying(true)
    router.refresh()
    reset()
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
