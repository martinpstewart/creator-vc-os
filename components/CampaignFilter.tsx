'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

type Campaign = { id: number; name: string }

export default function CampaignFilter({
  campaigns,
  selected,
}: {
  campaigns: Campaign[]
  selected: number[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  function toggle(id: number) {
    const next = selected.includes(id)
      ? selected.filter(x => x !== id)
      : [...selected, id]

    const params = new URLSearchParams(searchParams.toString())
    params.delete('page')
    if (next.length === 0) {
      params.delete('campaigns')
    } else {
      params.set('campaigns', next.join(','))
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('campaigns')
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  const label =
    selected.length === 0
      ? 'All campaigns'
      : selected.length === 1
      ? campaigns.find(c => c.id === selected[0])?.name ?? '1 campaign'
      : `${selected.length} campaigns`

  return (
    <div ref={ref} className="relative w-full sm:w-auto">
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full sm:w-auto flex items-center justify-between sm:justify-start gap-2 px-4 py-2 rounded-lg border text-sm transition-colors ${
          selected.length > 0
            ? 'bg-zinc-800 border-zinc-600 text-white'
            : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600'
        }`}
      >
        <span className="truncate">{label}</span>
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 sm:right-auto top-full mt-1.5 z-10 sm:w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 space-y-0.5">
            {campaigns.map(c => {
              const checked = selected.includes(c.id)
              return (
                <button
                  key={c.id}
                  onClick={() => toggle(c.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    checked ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-white'
                  }`}
                >
                  <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ${
                    checked ? 'bg-white border-white' : 'border-zinc-600'
                  }`}>
                    {checked && (
                      <svg className="w-2.5 h-2.5 text-zinc-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  {c.name}
                </button>
              )
            })}
          </div>
          {selected.length > 0 && (
            <div className="border-t border-zinc-800 p-2">
              <button
                onClick={clearAll}
                className="w-full px-3 py-1.5 text-xs text-zinc-500 hover:text-white transition-colors text-left"
              >
                Clear filter
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
