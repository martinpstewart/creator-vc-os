'use client'

// Like DateRangeFilter (used on /tickets) but STAGED: changes update
// local state only. A Refresh button commits to URL state, triggering
// the server re-fetch. The button highlights when local diverges from
// what's currently in the URL — gives the user explicit control over
// when the heavier orders query reruns.

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type Preset = {
  key: string
  label: string
  compute: (now: Date) => { from: string; to: string }
}

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

const PRESETS: Preset[] = [
  { key: '7d',         label: 'Last 7 days',  compute: (now) => ({ from: ymd(addDays(now, -7)),  to: ymd(addDays(now, 1)) }) },
  { key: '30d',        label: 'Last 30 days', compute: (now) => ({ from: ymd(addDays(now, -30)), to: ymd(addDays(now, 1)) }) },
  { key: '90d',        label: 'Last 90 days', compute: (now) => ({ from: ymd(addDays(now, -90)), to: ymd(addDays(now, 1)) }) },
  { key: 'this-month', label: 'This month',   compute: (now) => ({ from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)),     to: ymd(addDays(now, 1)) }) },
  { key: 'last-month', label: 'Last month',   compute: (now) => ({ from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth(), 1)) }) },
  { key: 'all',        label: 'All time',     compute: () => ({ from: '', to: '' }) },
]

export type DateRangeValue = { from: string | null; to: string | null }

export default function OrdersDateRangeFilter({ value }: { value: DateRangeValue }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  // Staged local copy — the inputs and chips edit this. URL is only
  // written when the user clicks Refresh.
  const [localFrom, setLocalFrom] = useState<string>(value.from ?? '')
  const [localTo, setLocalTo] = useState<string>(value.to ?? '')

  // When the URL changes from outside (e.g. campaign nav, product
  // multi-select), reset local back to the new URL values so the
  // Refresh button's "dirty" state matches reality.
  useEffect(() => {
    setLocalFrom(value.from ?? '')
    setLocalTo(value.to ?? '')
  }, [value.from, value.to])

  const dirty = localFrom !== (value.from ?? '') || localTo !== (value.to ?? '')

  function commit() {
    const sp = new URLSearchParams(params.toString())
    if (localFrom) sp.set('from', localFrom); else sp.delete('from')
    if (localTo)   sp.set('to',   localTo);   else sp.delete('to')
    sp.delete('page')
    router.push(`${pathname}?${sp.toString()}`)
  }

  // Active preset highlight: match staged (localFrom, localTo) against
  // each preset's computed pair. "All time" wins when both bounds are
  // empty.
  const now = new Date()
  const activeKey = (() => {
    if (!localFrom && !localTo) return 'all'
    for (const p of PRESETS) {
      if (p.key === 'all') continue
      const got = p.compute(now)
      if (got.from === localFrom && got.to === localTo) return p.key
    }
    return 'custom'
  })()

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {PRESETS.map((p) => {
        const active = p.key === activeKey
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => {
              const { from, to } = p.compute(new Date())
              setLocalFrom(from)
              setLocalTo(to)
            }}
            className={`px-3 py-1.5 rounded-full font-medium transition-colors ${
              active
                ? 'bg-[#3B9EE8] text-white'
                : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700/80'
            }`}
          >
            {p.label}
          </button>
        )
      })}

      {/* Custom range — two date inputs. */}
      <div className="flex items-center gap-1.5 ml-1">
        <input
          type="date"
          value={localFrom}
          onChange={(e) => setLocalFrom(e.target.value)}
          className="bg-zinc-800/80 border border-zinc-700 rounded px-2 py-1 text-xs text-white"
          aria-label="From date"
        />
        <span className="text-zinc-500">→</span>
        <input
          type="date"
          value={localTo}
          onChange={(e) => setLocalTo(e.target.value)}
          className="bg-zinc-800/80 border border-zinc-700 rounded px-2 py-1 text-xs text-white"
          aria-label="To date"
        />
      </div>

      {/* Refresh — highlighted blue when local state diverges from URL.
          Otherwise greyed out so the user knows there's nothing to
          apply. Disabled in the clean state so accidental clicks don't
          spin up an identical query. */}
      <button
        type="button"
        onClick={commit}
        disabled={!dirty}
        title={dirty ? 'Apply date range' : 'Date range already applied'}
        className={`ml-2 px-3 py-1.5 rounded-full font-medium transition-colors ${
          dirty
            ? 'bg-[#3B9EE8] text-white shadow-[0_0_0_1px_rgba(59,158,232,0.4),0_2px_8px_-2px_rgba(59,158,232,0.5)] hover:bg-[#2f8ed4]'
            : 'bg-zinc-800/40 text-zinc-500 cursor-not-allowed'
        }`}
      >
        Refresh
      </button>
    </div>
  )
}
