'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import { relTime, sendStatusTone, type SendListRow } from './types'

const PAGE_SIZE = 50

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US').format(n)
}

function rate(num: number, denom: number): string {
  if (!denom) return '—'
  const pct = (num / denom) * 100
  if (pct < 0.1 && num > 0) return '<0.1%'
  return `${pct.toFixed(1)}%`
}

// Which timestamp to display next to the status, picking the most
// meaningful one for that lifecycle stage.
function statusTimestamp(s: SendListRow): { label: string; iso: string | null } {
  switch (s.status) {
    case 'sent':
      return { label: 'Sent', iso: s.sent_at }
    case 'sending':
      return { label: 'Started', iso: s.sending_started_at }
    case 'scheduled':
      return { label: 'Scheduled for', iso: s.scheduled_for }
    case 'cancelled':
    case 'failed':
      return { label: 'Updated', iso: s.sent_at ?? s.sending_started_at ?? s.created_at }
    case 'draft':
    default:
      return { label: 'Created', iso: s.created_at }
  }
}

export default function SendsList() {
  const [rows, setRows] = useState<SendListRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const supabase = createClient()
        const [{ data: list, error: e1 }, { data: count, error: e2 }] = await Promise.all([
          supabase.rpc('marketing_list_sends', { p_page: page, p_page_size: PAGE_SIZE }),
          supabase.rpc('marketing_count_sends'),
        ])
        if (cancelled) return
        if (e1) throw e1
        if (e2) throw e2
        setRows((list as SendListRow[]) ?? [])
        setTotal(typeof count === 'number' ? count : Number(count ?? 0))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [page])

  const totalPages = total != null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1

  if (!loading && rows.length === 0 && !error) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-16 text-center">
        <Inbox size={32} className="mx-auto text-zinc-600 mb-3" strokeWidth={1.5} />
        <p className="text-sm text-zinc-300 font-medium mb-1">No sends yet</p>
        <p className="text-xs text-zinc-500">
          Every email you send will land here with its delivery and engagement metrics.
        </p>
      </div>
    )
  }

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-white">Sent emails</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          {total != null ? `${fmt(total)} send${total === 1 ? '' : 's'}` : 'Loading…'}
        </p>
      </div>

      {error && (
        <div className="bg-red-950/40 border-b border-red-900/60 px-5 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-950/40">
              <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                Name
              </th>
              <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                Subject
              </th>
              <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                Segment
              </th>
              <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                Status
              </th>
              <th className="text-right px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                Recipients
              </th>
              <th className="text-right px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                Opens
              </th>
              <th className="text-right px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                Bounces
              </th>
              <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap">
                When
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const tone = sendStatusTone(s.status)
              const ts = statusTimestamp(s)
              return (
                <tr
                  key={s.id}
                  className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30 cursor-pointer"
                  onClick={(e) => {
                    // Allow middle-click / cmd-click to open in new tab.
                    if (e.metaKey || e.ctrlKey) return
                    e.currentTarget.querySelector<HTMLAnchorElement>('a[data-row-link]')?.click()
                  }}
                >
                  <td className="px-5 py-3 font-medium text-white">
                    <Link
                      data-row-link
                      href={`/marketing/sends/${s.id}`}
                      className="hover:text-[#3B9EE8] transition-colors"
                    >
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-zinc-400 max-w-xs truncate" title={s.subject}>
                    {s.subject}
                  </td>
                  <td className="px-5 py-3 text-zinc-500 text-xs">
                    {s.segment_name ?? <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold border ${tone.bg} ${tone.text} ${tone.border}`}
                    >
                      {tone.label}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-zinc-300 tabular-nums">
                    {fmt(s.total_recipients)}
                  </td>
                  <td className="px-5 py-3 text-right text-zinc-300 tabular-nums">
                    <span className="font-medium">{fmt(s.total_opened)}</span>
                    <span className="text-zinc-600 text-xs ml-1">
                      {rate(s.total_opened, s.total_delivered)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-zinc-300 tabular-nums">
                    <span className="font-medium">{fmt(s.total_bounced)}</span>
                    <span className="text-zinc-600 text-xs ml-1">
                      {rate(s.total_bounced, s.total_sent)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-zinc-500 text-xs whitespace-nowrap">
                    <span className="text-zinc-600">{ts.label} </span>
                    {relTime(ts.iso)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {total != null && total > PAGE_SIZE && (
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between text-xs">
          <p className="text-zinc-500">
            Page {page} of {totalPages} · {fmt(total)} send{total === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="p-1.5 rounded border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 disabled:opacity-30 transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="p-1.5 rounded border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 disabled:opacity-30 transition-colors"
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
