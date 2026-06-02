'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink, Pencil } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { relTime, micrositeStatusTone } from './types'

// ============================================================
// Types — mirror what marketing_microsite_dashboard returns.
// ============================================================

type PageMeta = {
  id: number
  title: string
  slug: string
  status: string
  campaign_id: number | null
  campaign_name: string | null
  published_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
}

type Totals = {
  total: number
  today: number
  last_7: number
  last_30: number
  first_at: string | null
  last_at: string | null
}

type TimelinePoint = { date: string; count: number }
type CountryRow    = { code: string; count: number }
type UtmRow        = { source: string; count: number }
type RecentRow = {
  email: string
  first_name: string | null
  last_name: string | null
  country_code: string | null
  utm_source: string | null
  submitted_at: string
}

export type DashboardPayload = {
  page: PageMeta
  totals: Totals
  timeline: TimelinePoint[]
  countries: CountryRow[]
  utm: UtmRow[]
  recent: RecentRow[]
}

// ============================================================
// Helpers
// ============================================================

const intlNum = new Intl.NumberFormat('en-US')
function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return intlNum.format(n)
}

function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

let _regionNames: Intl.DisplayNames | null = null
function regionName(code: string): string {
  if (!code || code === 'XX') return 'Unknown'
  if (typeof Intl === 'undefined') return code
  try {
    _regionNames ||= new Intl.DisplayNames(['en'], { type: 'region' })
    return _regionNames.of(code) ?? code
  } catch {
    return code
  }
}

function flag(code: string | null): string {
  if (!code || code.length !== 2 || code === 'XX') return ''
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(0x1f1a5 + c.charCodeAt(0)))
}

// ============================================================
// Main component
// ============================================================

export default function PageDashboard({ data }: { data: DashboardPayload }) {
  const router = useRouter()
  const tone = micrositeStatusTone(data.page.status)
  const publicUrl = `/p/${data.page.slug}`

  // Realtime: re-fetch the whole dashboard bundle whenever a new signup
  // lands on THIS microsite. Filter at the subscription level so other
  // pages' inserts don't trigger our refresh.
  //
  // Debounced 400ms — a burst of submissions only triggers one re-render
  // rather than N. router.refresh() refreshes server data without
  // dropping client state (the timeline animation, etc).
  const [live, setLive] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`microsite-signups:${data.page.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'aa_03_marketing',
          table: 'microsite_signups',
          filter: `microsite_id=eq.${data.page.id}`,
        },
        () => {
          if (refreshTimer.current) clearTimeout(refreshTimer.current)
          refreshTimer.current = setTimeout(() => router.refresh(), 400)
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setLive('live')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')
          setLive('offline')
      })

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      supabase.removeChannel(channel)
    }
  }, [data.page.id, router])

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      {/* Back */}
      <Link
        href="/marketing?tab=landing&sub=pages"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors mb-4"
      >
        <ArrowLeft size={14} /> Back to pages
      </Link>

      {/* Header */}
      <div className="mb-6 md:mb-8 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h1 className="text-xl md:text-2xl font-semibold text-white truncate">
              {data.page.title}
            </h1>
            <span
              className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold border ${tone.bg} ${tone.text} ${tone.border}`}
            >
              {tone.label}
            </span>
            {/* Realtime subscription indicator. Green = receiving live events,
                amber = handshaking, red = WS dropped. */}
            <span
              className="inline-flex items-center gap-1 text-[10px] text-zinc-500"
              title={
                live === 'live'
                  ? 'Subscribed — new signups will appear without reload'
                  : live === 'connecting'
                    ? 'Connecting to live updates…'
                    : 'Live updates unavailable — refresh to fetch latest'
              }
            >
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  live === 'live'
                    ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]'
                    : live === 'connecting'
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-red-500'
                }`}
              />
              {live === 'live' ? 'Live' : live === 'connecting' ? 'Connecting' : 'Offline'}
            </span>
          </div>
          <p className="text-xs text-zinc-500 font-mono">
            {publicUrl}
            {data.page.campaign_name && (
              <span className="font-sans">
                <span className="text-zinc-700 mx-1.5">·</span>
                {data.page.campaign_name}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {data.page.status === 'live' && (
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-md bg-zinc-800 text-zinc-100 hover:bg-zinc-700 transition-colors"
            >
              <ExternalLink size={14} /> View live
            </a>
          )}
          <Link
            href={`/marketing/pages/${data.page.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] transition-colors"
          >
            <Pencil size={14} /> Update
          </Link>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Total signups" value={fmt(data.totals.total)} accent="emerald" />
        <KpiCard label="Today" value={fmt(data.totals.today)} />
        <KpiCard label="Last 7 days" value={fmt(data.totals.last_7)} />
        <KpiCard label="Last 30 days" value={fmt(data.totals.last_30)} />
      </div>

      {/* Timeline */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Signups, last 30 days</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {data.totals.first_at
                ? `First on ${fmtDateShort(data.totals.first_at)} · last on ${fmtDateShort(data.totals.last_at!)}`
                : 'No signups yet.'}
            </p>
          </div>
        </div>
        <Timeline points={data.timeline} />
      </section>

      {/* Country + UTM */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
        <Breakdown
          title="Top countries"
          empty="No country data yet — Vercel resolves this from the visitor's IP at submit time."
          items={data.countries.map((c) => ({
            key: c.code,
            label: `${flag(c.code)} ${regionName(c.code)}`,
            count: c.count,
          }))}
        />
        <Breakdown
          title="Top traffic sources"
          empty="No UTM-tagged traffic yet."
          items={data.utm.map((u) => ({
            key: u.source,
            label: u.source,
            count: u.count,
          }))}
        />
      </div>

      {/* Recent */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-white">Recent signups</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Latest 20. Full list lives in the Contacts tab.
          </p>
        </div>
        {data.recent.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-zinc-500">
            No signups yet. Once the page goes live, submissions will land here in real time.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/40">
                  <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">Email</th>
                  <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">Country</th>
                  <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">Source</th>
                  <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap">When</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => {
                  const fullName = [r.first_name, r.last_name].filter(Boolean).join(' ') || '—'
                  return (
                    <tr key={`${r.email}-${r.submitted_at}`} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                      <td className="px-5 py-3 text-white font-medium">{r.email}</td>
                      <td className="px-5 py-3 text-zinc-300">{fullName}</td>
                      <td className="px-5 py-3 text-zinc-400 whitespace-nowrap">
                        {r.country_code ? (
                          <>
                            <span className="mr-1">{flag(r.country_code)}</span>
                            <span className="text-xs">{regionName(r.country_code)}</span>
                          </>
                        ) : (
                          <span className="text-zinc-700">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-zinc-400 text-xs">
                        {r.utm_source ?? <span className="text-zinc-700">(direct)</span>}
                      </td>
                      <td className="px-5 py-3 text-zinc-500 text-xs whitespace-nowrap">
                        {relTime(r.submitted_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// ============================================================
// KPI / Breakdown / Timeline sub-components
// ============================================================

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: 'emerald'
}) {
  const valueColor = accent === 'emerald' ? 'text-emerald-300' : 'text-white'
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">{label}</p>
      <p className={`text-3xl md:text-4xl font-bold tabular-nums ${valueColor}`}>{value}</p>
    </div>
  )
}

function Breakdown({
  title,
  items,
  empty,
}: {
  title: string
  empty: string
  items: { key: string; label: string; count: number }[]
}) {
  const max = items.reduce((m, i) => Math.max(m, i.count), 0)
  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-white mb-3">{title}</h2>
      {items.length === 0 ? (
        <p className="text-xs text-zinc-500">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => {
            const pct = max > 0 ? (i.count / max) * 100 : 0
            return (
              <li key={i.key} className="text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-zinc-200 truncate pr-2">{i.label}</span>
                  <span className="text-zinc-400 tabular-nums">{fmt(i.count)}</span>
                </div>
                <div className="h-1.5 bg-zinc-950 rounded overflow-hidden">
                  <div
                    className="h-full bg-[#3B9EE8] rounded transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Timeline({ points }: { points: TimelinePoint[] }) {
  if (points.length === 0) {
    return <p className="text-xs text-zinc-500">No data.</p>
  }

  const w = 720
  const h = 140
  const pad = { top: 8, right: 8, bottom: 18, left: 8 }
  const innerW = w - pad.left - pad.right
  const innerH = h - pad.top - pad.bottom

  const maxCount = Math.max(...points.map((p) => p.count), 1)
  const step = innerW / Math.max(points.length - 1, 1)

  // Path generation.
  const coords = points.map((p, i) => ({
    x: pad.left + i * step,
    y: pad.top + innerH - (p.count / maxCount) * innerH,
    date: p.date,
    count: p.count,
  }))
  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ')
  const areaPath =
    `M${coords[0].x},${pad.top + innerH} ` +
    coords.map((c) => `L${c.x},${c.y}`).join(' ') +
    ` L${coords[coords.length - 1].x},${pad.top + innerH} Z`

  // X-axis labels: first, middle, last.
  const labelIdxs = [0, Math.floor(points.length / 2), points.length - 1]

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" role="img" aria-label="Signups timeline">
        <defs>
          <linearGradient id="cvc-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#3B9EE8" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#3B9EE8" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* baseline */}
        <line
          x1={pad.left}
          x2={w - pad.right}
          y1={pad.top + innerH}
          y2={pad.top + innerH}
          stroke="#27272a"
          strokeWidth="1"
        />
        {/* area + line */}
        <path d={areaPath} fill="url(#cvc-area)" />
        <path d={linePath} fill="none" stroke="#3B9EE8" strokeWidth="2" strokeLinejoin="round" />
        {/* dots on non-zero days */}
        {coords.map((c) =>
          c.count > 0 ? (
            <circle key={c.date} cx={c.x} cy={c.y} r="2.5" fill="#3B9EE8">
              <title>
                {fmtDateShort(c.date)}: {fmt(c.count)} signup{c.count === 1 ? '' : 's'}
              </title>
            </circle>
          ) : null,
        )}
        {/* x-axis labels */}
        {labelIdxs.map((i) => (
          <text
            key={i}
            x={coords[i].x}
            y={h - 4}
            textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
            fontSize="10"
            fill="#71717a"
          >
            {fmtDateShort(coords[i].date)}
          </text>
        ))}
      </svg>
    </div>
  )
}
