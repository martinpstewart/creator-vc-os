'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { useAuth } from './AuthProvider'

type OrderRow = {
  order_key: string
  source: string
  order_number: string | null
  order_date: string | null
  email: string | null
  customer_name: string | null
  status: string | null
  amount_usd: number | string | null
  product_ids: number[]
  total_count: number
}

function fmt(n: number | string | null) {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  return new Intl.NumberFormat('en-US').format(num)
}
function fmtUsd(n: number | string | null) {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (!Number.isFinite(num)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(num)
}
function fmtDate(s: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const SOURCE_LABEL: Record<string, string> = {
  shopify: 'Shopify',
  shopify_legacy: 'Shopify (legacy)',
  gumroad: 'Gumroad',
  wix: 'Wix',
  isod: 'ISOD',
}
function sourceLabel(s: string): string {
  return SOURCE_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1)
}
function sourceBadgeClass(s: string): string {
  switch (s) {
    case 'shopify':         return 'bg-zinc-800 text-zinc-300'
    case 'shopify_legacy':  return 'bg-amber-900/40 text-amber-200'
    case 'gumroad':         return 'bg-emerald-900/40 text-emerald-200'
    case 'wix':             return 'bg-purple-900/40 text-purple-200'
    case 'isod':            return 'bg-blue-900/40 text-blue-200'
    default:                return 'bg-zinc-800 text-zinc-400'
  }
}

const PAGE_SIZE = 100

// `to` is YYYY-MM-DD; the reader uses half-open `< to`. Both filter
// fields are passed through unchanged — the RPC handles NULL/empty.
function toIso(d: string | null): string | null {
  if (!d) return null
  return new Date(`${d}T00:00:00Z`).toISOString()
}

type Summary = {
  total_orders: number
  total_revenue: number | string
  unique_backers: number
  total_units: number
}

export default function CampaignOrders({
  campaignId,
  initialOrders,
  initialTotal,
  initialPage,
  initialProductIds,
  initialFrom,
  initialTo,
  initialKinds,
  summary,
  showRevenue,
}: {
  campaignId: number
  initialOrders: OrderRow[]
  initialTotal: number
  initialPage: number
  initialProductIds: number[]
  initialFrom: string | null
  initialTo: string | null
  initialKinds: string[]
  summary: Summary
  showRevenue: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [page, setPage] = useState(initialPage)
  const [orders, setOrders] = useState<OrderRow[]>(initialOrders)
  const [total, setTotal] = useState(initialTotal)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const supabase = createClient()
  const { role } = useAuth()
  const showSpend = showRevenue && role === 'admin'

  // Reset when the server re-fetches with new filters
  useEffect(() => {
    setOrders(initialOrders)
    setTotal(initialTotal)
    setPage(initialPage)
    setFetchError(null)
  }, [initialOrders, initialTotal, initialPage, initialProductIds, initialFrom, initialTo, initialKinds])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  async function goToPage(p: number) {
    if (p < 1 || p > totalPages || p === page) return
    setLoading(true)
    setFetchError(null)
    try {
      const { data, error } = await supabase.rpc('get_campaign_orders', {
        p_campaign_id: campaignId,
        p_product_ids: initialProductIds.length > 0 ? initialProductIds : null,
        p_start_date: toIso(initialFrom),
        p_end_date: toIso(initialTo),
        p_kinds: initialKinds.length > 0 ? initialKinds : null,
        p_page: p,
        p_page_size: PAGE_SIZE,
      })
      if (error) {
        console.error('[CampaignOrders] RPC error', error)
        setFetchError(`${error.code ?? ''}: ${error.message}`)
        return
      }
      const rows = (data ?? []) as OrderRow[]
      setOrders(rows)
      const t = rows.length > 0 ? Number(rows[0].total_count) : total
      setTotal(t)
      setPage(p)

      const params = new URLSearchParams(searchParams.toString())
      if (p > 1) params.set('page', String(p))
      else params.delete('page')
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    } catch (e) {
      console.error('[CampaignOrders] unexpected error', e)
      setFetchError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const start = (page - 1) * PAGE_SIZE + 1
  const end = Math.min(page * PAGE_SIZE, total)
  const hasFilter = initialProductIds.length > 0 || !!initialFrom || !!initialTo || initialKinds.length > 0

  return (
    <>
      {/* KPI header — counts the filtered set, not the campaign overall.
          Revenue + units are CAMPAIGN-ATTRIBUTED (line aggregates), so
          cross-sell orders don't double-count. */}
      <div className={`grid grid-cols-2 gap-3 md:gap-4 mb-4 ${showSpend ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        <KpiTile label="Orders" value={fmt(summary.total_orders)} />
        {showSpend && <KpiTile label="Revenue" value={fmtUsd(summary.total_revenue)} />}
        <KpiTile label="Unique Backers" value={fmt(summary.unique_backers)} />
        <KpiTile label="Units" value={fmt(summary.total_units)} />
      </div>

    <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-white">
          Orders
          {hasFilter && (
            <span className="ml-2 text-xs font-normal text-zinc-400">
              · filtered
            </span>
          )}
        </h2>
        <span className="text-xs text-zinc-500">
          {total > PAGE_SIZE ? `${fmt(start)}–${fmt(end)} of ${fmt(total)}` : `${fmt(total)} total`}
        </span>
      </div>

      {fetchError ? (
        <p className="px-6 py-8 text-center text-red-400 text-sm">Error loading orders: {fetchError}</p>
      ) : orders.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className={`w-full text-sm min-w-[760px] transition-opacity ${loading ? 'opacity-40' : ''}`}>
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Date</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Source</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Order</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Customer</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Status</th>
                  {showSpend && (
                    <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Amount</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr
                    key={o.order_key}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="px-6 py-3.5 text-zinc-300 whitespace-nowrap">{fmtDate(o.order_date)}</td>
                    <td className="px-6 py-3.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${sourceBadgeClass(o.source)}`}>
                        {sourceLabel(o.source)}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-zinc-400 tabular-nums">{o.order_number || '—'}</td>
                    <td className="px-6 py-3.5">
                      <p className="text-white">{o.customer_name || '—'}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{o.email || '—'}</p>
                    </td>
                    <td className="px-6 py-3.5 text-zinc-400 capitalize">{o.status || '—'}</td>
                    {showSpend && (
                      <td className="px-6 py-3.5 text-right font-medium text-white tabular-nums">
                        {fmtUsd(o.amount_usd)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
          {hasFilter ? 'No orders match the current filters.' : 'No orders for this campaign.'}
        </p>
      )}
    </div>
    </>
  )
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5">
      <p className="text-[11px] md:text-xs text-zinc-500 uppercase tracking-wide font-medium">{label}</p>
      <p className="text-xl md:text-2xl font-semibold text-white mt-2 tabular-nums">{value}</p>
    </div>
  )
}
