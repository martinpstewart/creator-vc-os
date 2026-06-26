'use client'

// Multi-select for line-kind (digital / physical). URL-state via the
// `kinds` searchParam (comma-separated). Mirrors CampaignFilter /
// ProductMultiSelect — same chevron/checkbox affordances. Both kinds
// selected (default) ≡ no filter. Apply on toggle (single decisive
// click; nothing to stage).

import { useState, useRef, useEffect } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

export type KindValue = 'digital' | 'physical'

const KINDS: { id: KindValue; label: string }[] = [
  { id: 'digital',  label: 'Digital' },
  { id: 'physical', label: 'Physical' },
]

export default function KindFilter({ selected }: { selected: KindValue[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  // Empty `selected` = no URL param = filter inactive = visually both
  // kinds are checked. Toggle must work off this EFFECTIVE set, not
  // the raw URL-derived `selected`, otherwise clicking a checked box
  // while in the default state silently flips to "only the other one"
  // — which is what the user just complained about.
  const effective: KindValue[] = selected.length === 0 ? KINDS.map((k) => k.id) : selected

  function toggle(id: KindValue) {
    const next: KindValue[] = effective.includes(id)
      ? effective.filter((x) => x !== id)
      : [...effective, id]

    const params = new URLSearchParams(searchParams.toString())
    params.delete('page')
    // "Both checked" = "filter inactive" — encoded as no URL param.
    // Zero checked is also encoded as no URL param (filtering to no
    // kinds returns no rows; default to All instead to avoid an
    // empty-result trap).
    if (next.length === 0 || next.length === KINDS.length) {
      params.delete('kinds')
    } else {
      params.set('kinds', next.join(','))
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  const label =
    effective.length === KINDS.length
      ? 'All kinds'
      : effective.length === 1
      ? KINDS.find((k) => k.id === effective[0])?.label ?? '1 kind'
      : `${effective.length} kinds`

  return (
    <div ref={ref} className="relative w-full sm:w-auto">
      <button
        onClick={() => setOpen((o) => !o)}
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
        <div className="absolute left-0 sm:right-auto top-full mt-1.5 z-10 w-44 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 space-y-0.5">
            {KINDS.map((k) => {
              const checked = effective.includes(k.id)
              return (
                <button
                  key={k.id}
                  onClick={() => toggle(k.id)}
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
                  {k.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
