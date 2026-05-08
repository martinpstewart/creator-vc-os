'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useRef } from 'react'

export default function CustomerSearch({ defaultValue }: { defaultValue?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)

  function submit(q: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('page')
    if (q.trim()) {
      params.set('q', q.trim())
    } else {
      params.delete('q')
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  function handleClear() {
    if (inputRef.current) inputRef.current.value = ''
    submit('')
  }

  return (
    <div className="flex items-center gap-2 w-full sm:w-auto">
      <div className="relative flex-1 sm:flex-initial">
        <input
          ref={inputRef}
          type="text"
          defaultValue={defaultValue}
          placeholder="Search name or email…"
          onKeyDown={e => e.key === 'Enter' && submit((e.target as HTMLInputElement).value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 w-full sm:w-64"
        />
        {defaultValue && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors text-lg leading-none"
          >
            ×
          </button>
        )}
      </div>
      <button
        onClick={() => submit(inputRef.current?.value ?? '')}
        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm text-white rounded-lg transition-colors"
      >
        Search
      </button>
    </div>
  )
}
