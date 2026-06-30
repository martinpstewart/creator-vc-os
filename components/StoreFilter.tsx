'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

// Stores are a fixed enum so the component owns the option list rather
// than receiving it as a prop. Order matches their relative volume
// (Shopify is the busy one; Wix is tiny).
//
// ISOD is intentionally absent — it's a documentary, not a store. Its
// orders were placed on the pre-launch Shopify checkout, so
// get_customers_list folds 'isod'-tagged customers into the
// Shopify (legacy) filter.
const STORES = [
  { value: 'shopify',        label: 'Shopify' },
  { value: 'shopify_legacy', label: 'Shopify (legacy)' },
  { value: 'gumroad',        label: 'Gumroad' },
  { value: 'indiegogo',      label: 'Indiegogo' },
  { value: 'kickstarter',    label: 'Kickstarter' },
  { value: 'wix',            label: 'Wix' },
] as const

type StoreValue = (typeof STORES)[number]['value']

export default function StoreFilter({ selected }: { selected: StoreValue[] }) {
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

  function toggle(value: StoreValue) {
    const next = selected.includes(value)
      ? selected.filter((x) => x !== value)
      : [...selected, value]

    const params = new URLSearchParams(searchParams.toString())
    params.delete('page')
    if (next.length === 0) {
      params.delete('stores')
    } else {
      params.set('stores', next.join(','))
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('stores')
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  const label =
    selected.length === 0
      ? 'All stores'
      : selected.length === 1
        ? STORES.find((s) => s.value === selected[0])?.label ?? '1 store'
        : `${selected.length} stores`

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
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 sm:right-auto top-full mt-1.5 z-10 sm:w-56 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 space-y-0.5">
            {STORES.map((s) => {
              const checked = selected.includes(s.value)
              return (
                <button
                  key={s.value}
                  onClick={() => toggle(s.value)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    checked ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-white'
                  }`}
                >
                  <span
                    className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ${
                      checked ? 'bg-white border-white' : 'border-zinc-600'
                    }`}
                  >
                    {checked && (
                      <svg
                        className="w-2.5 h-2.5 text-zinc-900"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  {s.label}
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

// Helper so the page can validate/parse the URL param.
export const STORE_VALUES = STORES.map((s) => s.value) as readonly StoreValue[]
export type { StoreValue }
