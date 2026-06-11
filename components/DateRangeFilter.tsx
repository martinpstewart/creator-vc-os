'use client'

// Date-range filter for /tickets. URL-driven so a filtered view can
// be pasted into Slack and survives reloads. Quick-preset chips +
// custom range inputs. Range semantics: created_at >= from AND < to
// (inclusive lower, exclusive upper) — matches the "tickets received
// in [from, to)" intuition.

import { useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

// Each preset returns a {from, to} pair as ISO date strings (YYYY-MM-DD).
// `to` is the day AFTER the last day you want included — the SQL is
// half-open on the upper bound, so "this month so far" goes to tomorrow.
type Preset = {
  key: string
  label: string
  compute: (now: Date) => { from: string; to: string }
}

function ymd(d: Date): string {
  // Local-date YYYY-MM-DD; we deliberately avoid toISOString because it
  // shifts to UTC and can land you on the previous day in negative offsets.
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
  {
    key: '7d',
    label: 'Last 7 days',
    compute: (now) => ({ from: ymd(addDays(now, -7)), to: ymd(addDays(now, 1)) }),
  },
  {
    key: '30d',
    label: 'Last 30 days',
    compute: (now) => ({ from: ymd(addDays(now, -30)), to: ymd(addDays(now, 1)) }),
  },
  {
    key: '90d',
    label: 'Last 90 days',
    compute: (now) => ({ from: ymd(addDays(now, -90)), to: ymd(addDays(now, 1)) }),
  },
  {
    key: 'this-month',
    label: 'This month',
    compute: (now) => ({
      from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
      to:   ymd(addDays(now, 1)),
    }),
  },
  {
    key: 'last-month',
    label: 'Last month',
    compute: (now) => ({
      from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to:   ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
    }),
  },
  {
    key: 'all',
    label: 'All time',
    compute: () => ({ from: '', to: '' }),
  },
]

export type DateRangeValue = { from: string | null; to: string | null }

export default function DateRangeFilter({ value }: { value: DateRangeValue }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [, startTransition] = useTransition()

  function apply(from: string, to: string) {
    const sp = new URLSearchParams(params.toString())
    if (from) sp.set('from', from); else sp.delete('from')
    if (to)   sp.set('to', to);     else sp.delete('to')
    // Reset to page 1 — filtering changes the row set; old pagination
    // would land off the end.
    sp.delete('page')
    startTransition(() => {
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
    })
  }

  // Active preset highlight: match (from, to) against each preset's
  // computed pair. "All time" wins when both bounds are null/empty.
  const now = new Date()
  const activeKey = (() => {
    if (!value.from && !value.to) return 'all'
    for (const p of PRESETS) {
      if (p.key === 'all') continue
      const got = p.compute(now)
      if (got.from === value.from && got.to === value.to) return p.key
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
              apply(from, to)
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

      {/* Custom range — two date inputs. Wide enough to read the
          format, narrow enough to fit alongside the presets. */}
      <div className="flex items-center gap-1.5 ml-1">
        <input
          type="date"
          value={value.from ?? ''}
          onChange={(e) => apply(e.target.value, value.to ?? '')}
          className="bg-zinc-800/80 border border-zinc-700 rounded px-2 py-1 text-xs text-white"
          aria-label="From date"
        />
        <span className="text-zinc-500">→</span>
        <input
          type="date"
          value={value.to ?? ''}
          onChange={(e) => apply(value.from ?? '', e.target.value)}
          className="bg-zinc-800/80 border border-zinc-700 rounded px-2 py-1 text-xs text-white"
          aria-label="To date"
        />
      </div>
    </div>
  )
}
