'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Search, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import ClickableRow from '@/components/ClickableRow'
import {
  listTickets,
  STATUS_LABEL,
  PRIORITY_LABEL,
  statusTone,
  priorityTone,
  ticketHandler,
  ticketRequesterLabel,
  relTime,
  type TicketListRow,
  type TicketStatus,
  type TicketStatusCounts,
} from '@/lib/tickets'

const PAGE_SIZE = 25

type StatusFilter = 'all' | TicketStatus

// Status tabs reflect the Freshdesk vocabulary. The old new/open/closed
// values would now match nothing.
const TABS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'Open' },
  { label: 'Pending', value: 'Pending' },
  { label: 'Resolved', value: 'Resolved' },
  { label: 'Closed', value: 'Closed' },
]

export default function TicketsListView({
  initialRows,
  initialTotal,
  counts,
}: {
  initialRows: TicketListRow[]
  initialTotal: number
  // Per-status badge counts — server-fetched once, static for the
  // session. They reflect the full dataset, not the current search/page.
  counts: TicketStatusCounts
}) {
  const supabase = createClient()

  const [rows, setRows] = useState<TicketListRow[]>(initialRows)
  const [total, setTotal] = useState<number>(initialTotal)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Debounce the search input → search state (used in the fetch).
  // 300ms is the sweet spot for typing without hammering PostgREST.
  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(handle)
  }, [searchInput])

  // Reset paging whenever any filter changes.
  useEffect(() => {
    setPage(1)
  }, [status, search])

  const refetch = useCallback(
    async (nextPage: number) => {
      setLoading(true)
      setError(null)
      try {
        const { rows, total } = await listTickets(supabase, {
          status: status === 'all' ? null : status,
          search: search || null,
          page: nextPage,
          pageSize: PAGE_SIZE,
        })
        setRows(rows)
        setTotal(total)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load tickets')
      } finally {
        setLoading(false)
      }
    },
    [supabase, status, search],
  )

  // Re-fetch on any filter change. We skip the very first paint because the
  // server already gave us the page-1 default-filter results.
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    void refetch(page)
  }, [refetch, page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const end = Math.min(page * PAGE_SIZE, total)

  return (
    <div className="space-y-4">
      {/* Banner — make it explicit this is a read-only mirror. */}
      <div className="px-4 py-3 rounded-lg bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-400 flex items-center gap-2">
        <span>
          Tickets are managed in <span className="text-zinc-200">Freshdesk</span>. This view is read-only —
          click <span className="text-zinc-200">Open in Freshdesk</span> on any ticket to reply or change status.
        </span>
      </div>

      {/* Status tabs — each carries a count badge that reflects the
          full dataset (not the current search). */}
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <StatusTab
            key={t.value}
            label={t.label}
            value={t.value}
            current={status}
            onChange={setStatus}
            count={t.value === 'all' ? counts.all : counts[t.value]}
          />
        ))}
      </div>

      {/* Search box */}
      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          strokeWidth={1.75}
        />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by ticket #, subject, customer name or email…"
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
        />
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-950 border border-red-900/60 text-sm text-red-300">
          {error}
        </div>
      )}

      <div
        className={`bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto transition-opacity ${
          loading ? 'opacity-50' : ''
        }`}
      >
        <table className="w-full text-sm min-w-[1000px]">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-5 py-3 text-xs font-medium text-zinc-500">Ticket</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-zinc-500">Subject</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-zinc-500">Requester</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-zinc-500">Status</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-zinc-500">Priority</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-zinc-500">Agent</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-zinc-500">Updated</th>
              <th className="px-5 py-3 text-xs font-medium text-zinc-500"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const st = statusTone(t.status)
              const pt = priorityTone(t.priority)
              const requester = ticketRequesterLabel(t)
              const handler = ticketHandler(t)
              const customerHref = t.customer_email
                ? `/customers/${encodeURIComponent(t.customer_email)}`
                : null
              return (
                <ClickableRow
                  key={t.id}
                  href={`/tickets/${t.id}`}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="px-5 py-3 font-mono text-xs text-zinc-300">{t.ticket_number}</td>
                  <td className="px-5 py-3">
                    <Link
                      href={`/tickets/${t.id}`}
                      className="font-medium text-white hover:text-zinc-300 transition-colors"
                    >
                      {t.subject || <span className="text-zinc-500 italic">(no subject)</span>}
                    </Link>
                    {t.source && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-zinc-500 bg-zinc-800/80 px-1.5 py-0.5 rounded">
                        {t.source}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {customerHref ? (
                      <Link
                        href={customerHref}
                        onClick={(e) => e.stopPropagation()}
                        className="text-zinc-200 hover:text-white transition-colors"
                      >
                        {requester.primary}
                      </Link>
                    ) : (
                      <span className="text-zinc-300">{requester.primary}</span>
                    )}
                    {requester.secondary && (
                      <p className="text-[11px] text-zinc-500">{requester.secondary}</p>
                    )}
                    {!t.customer_id && (
                      <span className="mt-1 inline-flex items-center text-[10px] uppercase tracking-wide font-medium text-amber-400/80 bg-amber-950/40 border border-amber-900/60 px-1.5 py-0.5 rounded">
                        Unmatched
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border ${st.bg} ${st.text} ${st.border}`}
                    >
                      {STATUS_LABEL[t.status as TicketStatus] ?? t.status}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border ${pt.bg} ${pt.text} ${pt.border}`}
                    >
                      {PRIORITY_LABEL[t.priority] ?? t.priority}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-zinc-400">
                    {handler ?? <span className="text-zinc-600">Unassigned</span>}
                  </td>
                  <td className="px-5 py-3 text-zinc-400">
                    <span className="text-zinc-300">{relTime(t.last_actioned_at ?? t.created_at)}</span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {t.freshdesk_url && (
                      <a
                        href={t.freshdesk_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Open in Freshdesk"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-zinc-300 bg-zinc-800/60 hover:bg-zinc-700 hover:text-white transition-colors"
                      >
                        <ExternalLink size={12} strokeWidth={1.75} />
                        Freshdesk
                      </a>
                    )}
                  </td>
                </ClickableRow>
              )
            })}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center text-zinc-500 text-sm">
                  No tickets match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pager */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between px-1 py-2 text-xs text-zinc-500">
          <span>
            {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={14} strokeWidth={1.75} />
              Prev
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || loading}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <ChevronRight size={14} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusTab({
  label,
  value,
  current,
  onChange,
  count,
}: {
  label: string
  value: StatusFilter
  current: StatusFilter
  onChange: (v: StatusFilter) => void
  count: number
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
        active
          ? 'bg-[#3B9EE8] text-white'
          : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-white hover:border-zinc-700'
      }`}
    >
      <span>{label}</span>
      <span
        className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold tabular-nums ${
          active ? 'bg-white/20 text-white' : 'bg-zinc-800 text-zinc-300'
        }`}
      >
        {count.toLocaleString()}
      </span>
    </button>
  )
}
