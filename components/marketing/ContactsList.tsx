'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import { Search, ChevronLeft, ChevronRight, UserCircle } from 'lucide-react'
import { relTime, type ContactRow } from './types'

const PAGE_SIZE = 50

type ConsentFilter = 'all' | 'consented' | 'not_consented'
type SuppressionFilter = 'all' | 'clean' | 'unsubscribed' | 'bounced_hard' | 'complained'

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

function suppressionBadge(c: ContactRow): { label: string; tone: 'red' | 'amber' | null } {
  if (c.spam_complained_at) return { label: 'Complained', tone: 'red' }
  if (c.unsubscribed_at) return { label: 'Unsubscribed', tone: 'amber' }
  if (c.bounce_state === 'hard') return { label: 'Bounced', tone: 'red' }
  if (c.bounce_state === 'soft') return { label: 'Soft bounce', tone: 'amber' }
  return { label: '', tone: null }
}

export default function ContactsList() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [consent, setConsent] = useState<ConsentFilter>('all')
  const [suppression, setSuppression] = useState<SuppressionFilter>('all')
  const [includeTest, setIncludeTest] = useState(false)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<ContactRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Debounce the search input → search state.
  useEffect(() => {
    const h = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(h)
  }, [searchInput])

  // Reset to page 1 when filters change.
  useEffect(() => {
    setPage(1)
  }, [consent, suppression, includeTest])

  // Fetch on any filter / page change.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const supabase = createClient()
        const args = {
          p_search: search || null,
          p_consent_filter: consent,
          p_suppression: suppression,
          p_include_test: includeTest,
        }
        const [{ data: list, error: e1 }, { data: count, error: e2 }] = await Promise.all([
          supabase.rpc('marketing_list_contacts', {
            ...args,
            p_page: page,
            p_page_size: PAGE_SIZE,
          }),
          supabase.rpc('marketing_count_contacts', args),
        ])
        if (cancelled) return
        if (e1) throw e1
        if (e2) throw e2
        setRows((list as ContactRow[]) ?? [])
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
  }, [search, consent, suppression, includeTest, page])

  const totalPages = total != null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Contacts</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {total != null ? `${fmt(total)} matching` : 'Loading…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search email or name"
              className="bg-zinc-950 border border-zinc-800 rounded-md pl-7 pr-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 w-56"
            />
          </div>
          <select
            value={consent}
            onChange={(e) => setConsent(e.target.value as ConsentFilter)}
            className="bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:border-zinc-600"
          >
            <option value="all">All consent</option>
            <option value="consented">Consented</option>
            <option value="not_consented">Not consented</option>
          </select>
          <select
            value={suppression}
            onChange={(e) => setSuppression(e.target.value as SuppressionFilter)}
            className="bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:border-zinc-600"
          >
            <option value="all">All status</option>
            <option value="clean">Clean</option>
            <option value="unsubscribed">Unsubscribed</option>
            <option value="bounced_hard">Hard-bounced</option>
            <option value="complained">Complained</option>
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeTest}
              onChange={(e) => setIncludeTest(e.target.checked)}
              className="accent-[#3B9EE8]"
            />
            Show test
          </label>
        </div>
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
                Email
              </th>
              <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                Name
              </th>
              <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                Consent
              </th>
              <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                Status
              </th>
              <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                Customer
              </th>
              <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap">
                Last seen
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm text-zinc-500">
                  No contacts match those filters.
                </td>
              </tr>
            )}
            {rows.map((c) => {
              const supp = suppressionBadge(c)
              const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ') || '—'
              return (
                <tr
                  key={c.id}
                  onClick={(e) => {
                    // Allow cmd/ctrl-click to open in new tab via the email
                    // anchor below; plain clicks navigate the row.
                    if (e.metaKey || e.ctrlKey) return
                    router.push(`/marketing/contacts/${c.id}`)
                  }}
                  className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30 cursor-pointer"
                >
                  <td className="px-5 py-3 font-medium text-white">
                    {c.is_test && (
                      <span className="inline-flex mr-2 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-purple-950 text-purple-300 border border-purple-900/60">
                        Test
                      </span>
                    )}
                    <Link
                      href={`/marketing/contacts/${c.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-[#3B9EE8] transition-colors"
                    >
                      {c.email}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-zinc-300">{fullName}</td>
                  <td className="px-5 py-3">
                    {c.marketing_consent ? (
                      <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-900/60">
                        Consented
                      </span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-900 text-zinc-400 border border-zinc-800">
                        Not consented
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {supp.tone === 'red' && (
                      <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-red-950 text-red-300 border border-red-900/60">
                        {supp.label}
                      </span>
                    )}
                    {supp.tone === 'amber' && (
                      <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950 text-amber-300 border border-amber-900/60">
                        {supp.label}
                      </span>
                    )}
                    {supp.tone === null && <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="px-5 py-3 text-zinc-400">
                    {c.customer_id ? (
                      <Link
                        href={`/customers/${encodeURIComponent(c.email)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[#3B9EE8] hover:underline"
                        title="View customer record"
                      >
                        <UserCircle size={14} />
                        Linked
                      </Link>
                    ) : (
                      <span className="text-zinc-700">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-zinc-500 text-xs whitespace-nowrap">
                    {relTime(c.last_seen_at)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total != null && total > PAGE_SIZE && (
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between text-xs">
          <p className="text-zinc-500">
            Page {page} of {totalPages} · {fmt(total)} contacts
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
