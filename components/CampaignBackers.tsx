'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import ClickableRow from './ClickableRow'
import { useAuth } from './AuthProvider'

type BackerRow = {
  email: string
  full_name: string | null
  total_spend: number | null
  order_count: number
  total_count: number
}

function fmt(n: number | string | null, currency = false) {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  if (currency) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num)
  return new Intl.NumberFormat('en-US').format(num)
}

const PAGE_SIZE = 100

export default function CampaignBackers({
  campaignId,
  initialBackers,
  initialTotal,
  initialPage = 1,
  initialSearch = '',
}: {
  campaignId: number
  initialBackers: BackerRow[]
  initialTotal: number
  initialPage?: number
  initialSearch?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [page, setPage] = useState(initialPage)
  const [backers, setBackers] = useState<BackerRow[]>(initialBackers)
  const [total, setTotal] = useState(initialTotal)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const supabase = createClient()
  // Spend column is admin-only; team/support see the row without dollar amounts.
  const { role } = useAuth()
  const showSpend = role === 'admin'

  // Re-sync from server when the parent re-renders with new search /
  // initial page (e.g. user searches → URL changes → server re-fetches
  // initial 100 → these props change). Without this the component
  // would still show whatever the previous client-paginated state was.
  useEffect(() => {
    setBackers(initialBackers)
    setTotal(initialTotal)
    setPage(initialPage)
    setFetchError(null)
  }, [initialBackers, initialTotal, initialPage, initialSearch])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  async function goToPage(p: number) {
    if (p < 1 || p > totalPages || p === page) return
    setLoading(true)
    setFetchError(null)
    try {
      // Calls the snapshot reader directly with the same search term
      // the server rendered with — staying in the same "search session"
      // across pagination.
      const { data, error } = await supabase.rpc('get_campaign_backers_list', {
        p_campaign_id: campaignId,
        p_search: initialSearch && initialSearch.trim().length > 0 ? initialSearch.trim() : null,
        p_page: p,
        p_page_size: PAGE_SIZE,
      })
      if (error) {
        console.error('[CampaignBackers] RPC error', error)
        setFetchError(`${error.code ?? ''}: ${error.message}`)
        return
      }
      const rows = (data ?? []) as BackerRow[]
      setBackers(rows)
      const t = rows.length > 0 ? Number(rows[0].total_count) : total
      setTotal(t)
      setPage(p)

      // Reflect the page in the URL so refresh / share / back-button works.
      const params = new URLSearchParams(searchParams.toString())
      if (p > 1) params.set('page', String(p))
      else params.delete('page')
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    } catch (e) {
      console.error('[CampaignBackers] unexpected error', e)
      setFetchError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const start = (page - 1) * PAGE_SIZE + 1
  const end = Math.min(page * PAGE_SIZE, total)

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-white">
          Backers
          {initialSearch && (
            <span className="ml-2 text-xs font-normal text-zinc-400">
              · matching "{initialSearch}"
            </span>
          )}
        </h2>
        <span className="text-xs text-zinc-500">
          {total > PAGE_SIZE ? `${fmt(start)}–${fmt(end)} of ${fmt(total)}` : `${fmt(total)} total`}
        </span>
      </div>

      {fetchError ? (
        <p className="px-6 py-8 text-center text-red-400 text-sm">Error loading backers: {fetchError}</p>
      ) : backers.length > 0 ? (
        <>
          <table className={`w-full text-sm transition-opacity ${loading ? 'opacity-40' : ''}`}>
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Backer</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Email</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Orders</th>
                {showSpend && (
                  <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Spend</th>
                )}
              </tr>
            </thead>
            <tbody>
              {backers.map((b) => (
                <ClickableRow
                  key={b.email}
                  href={`/customers/${encodeURIComponent(b.email)}?campaign=${campaignId}`}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="px-6 py-3.5">
                    <Link
                      href={`/customers/${encodeURIComponent(b.email)}?campaign=${campaignId}`}
                      className="font-medium text-white hover:text-zinc-300 transition-colors"
                    >
                      {b.full_name || '—'}
                    </Link>
                  </td>
                  <td className="px-6 py-3.5 text-zinc-400">{b.email}</td>
                  <td className="px-6 py-3.5 text-right text-zinc-300">{b.order_count}</td>
                  {showSpend && (
                    <td className="px-6 py-3.5 text-right font-medium text-white">
                      {b.total_spend !== null ? fmt(b.total_spend, true) : '—'}
                    </td>
                  )}
                </ClickableRow>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-zinc-800 flex items-center justify-between">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page === 1 || loading}
                className="px-3 py-1.5 text-xs rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ← Prev
              </button>
              <span className="text-xs text-zinc-500">
                Page {fmt(page)} of {fmt(totalPages)}
              </span>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page === totalPages || loading}
                className="px-3 py-1.5 text-xs rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="px-6 py-8 text-center text-zinc-500 text-sm">
          {initialSearch ? `No backers match "${initialSearch}".` : 'No backers found'}
        </p>
      )}
    </div>
  )
}
