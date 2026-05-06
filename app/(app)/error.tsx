'use client'

import { useEffect } from 'react'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app] route error', error)
  }, [error])

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
          onClick={() => reset()}
          className="px-4 py-2 text-sm rounded-md bg-white text-zinc-900 hover:bg-zinc-200 transition-colors font-medium"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
