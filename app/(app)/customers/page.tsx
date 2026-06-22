import { getCustomers, getCampaigns } from '@/lib/supabase'
import Link from 'next/link'
import { Suspense } from 'react'
import { Users } from 'lucide-react'
import CampaignFilter from '@/components/CampaignFilter'
import CustomerSearch from '@/components/CustomerSearch'
import StoreFilter, { type StoreValue } from '@/components/StoreFilter'

// Validation list duplicated server-side: importing a runtime value
// from a 'use client' module gives the server a proxy, not an array,
// so .includes(...) blows up. Types are erased at compile time so
// the type-only import above is fine.
const STORE_VALUES_RUNTIME = ['shopify', 'shopify_legacy', 'gumroad', 'isod', 'indiegogo', 'kickstarter', 'wix'] as const
import ClickableRow from '@/components/ClickableRow'

// Bump Vercel's default 10s function timeout. get_customers_list is
// ~180ms warm (snapshot-backed) and getCustomers wraps it in
// unstable_cache (600s revalidate), so the page is normally fast.
// The 60s bump is belt-and-braces for serverless cold starts on
// Hobby, which silently caps at 10s but doesn't hurt to declare.
export const maxDuration = 60

function fmt(n: number | string | null, currency = false) {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  if (currency) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num)
  return new Intl.NumberFormat('en-US').format(num)
}

type CampaignDetail = { campaign_name: string; campaign_id: number }

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; campaigns?: string; stores?: string }>
}) {
  const { q, page: pageStr, campaigns: campaignsParam, stores: storesParam } = await searchParams
  const page = parseInt(pageStr ?? '1')
  const selectedIds = campaignsParam
    ? campaignsParam.split(',').map(Number).filter(Boolean)
    : []
  // Validate against the known store enum so a malformed URL can't
  // poison the RPC call.
  const selectedStores: StoreValue[] = storesParam
    ? (storesParam
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is StoreValue => (STORE_VALUES_RUNTIME as readonly string[]).includes(s)))
    : []

  const [{ customers, total }, campaigns] = await Promise.all([
    getCustomers(
      q,
      page,
      50,
      selectedIds.length > 0 ? selectedIds : undefined,
      selectedStores.length > 0 ? selectedStores : undefined,
    ),
    getCampaigns(),
  ])
  const totalPages = Math.ceil(total / 50)

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-9 h-9 md:w-10 md:h-10 rounded-lg bg-[#3B9EE8]">
            <Users size={18} className="text-white" strokeWidth={2.25} />
          </span>
          <div>
            <h1 className="text-xl md:text-2xl font-semibold text-white">Customers</h1>
            {/* Number now reflects PAYING customers only — the
                get_customers_list RPC filters on aa_02_crm.v_paying_customer_emails
                by default. Non-paying contacts (Backerkit signups,
                refund-only emails) are accessible by direct URL but
                hidden from this listing. */}
            <p className="text-sm text-zinc-500 mt-1">{fmt(total)} paying customers</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 flex-wrap">
          <Suspense>
            <StoreFilter selected={selectedStores} />
          </Suspense>
          <Suspense>
            <CampaignFilter campaigns={campaigns} selected={selectedIds} />
          </Suspense>
          <Suspense>
            <CustomerSearch defaultValue={q} />
          </Suspense>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Customer</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Campaigns</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Location</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Orders</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Total Spent</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => {
              const all: CampaignDetail[] = [
                ...((c.campaign_orders_detail as CampaignDetail[]) ?? []),
                ...((c.raw_orders_detail as CampaignDetail[]) ?? []),
                ...((c.isod_orders_detail as CampaignDetail[]) ?? []),
                // Historic platforms (indiegogo / kickstarter / wix /
                // shopify_legacy / gumroad). Without this branch,
                // customers whose only attribution is via historic
                // imports show an empty Campaigns column even though
                // they're tied to ISOTLAH / ISOD 80's / etc.
                ...((c.historic_orders_detail as CampaignDetail[]) ?? []),
              ]
              const customerCampaigns = [...new Map(all.map(x => [x.campaign_id, x])).values()]

              return (
                <ClickableRow
                  key={c.email}
                  href={`/customers/${encodeURIComponent(c.email)}`}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="px-6 py-3.5">
                    <Link href={`/customers/${encodeURIComponent(c.email)}`} className="block">
                      <p className="font-medium text-white">{c.full_name || '—'}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{c.email}</p>
                    </Link>
                  </td>
                  <td className="px-6 py-3.5">
                    <div className="flex flex-wrap gap-1">
                      {customerCampaigns.length > 0
                        ? customerCampaigns.map(camp => (
                            <span
                              key={camp.campaign_id}
                              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                                selectedIds.includes(camp.campaign_id)
                                  ? 'bg-white/10 text-white'
                                  : 'bg-zinc-800 text-zinc-300'
                              }`}
                            >
                              {camp.campaign_name}
                            </span>
                          ))
                        : <span className="text-zinc-600 text-xs">—</span>
                      }
                    </div>
                  </td>
                  <td className="px-6 py-3.5 text-zinc-400 text-xs">
                    {c.shipping_city ? `${c.shipping_city}, ${c.shipping_country}` : '—'}
                  </td>
                  <td className="px-6 py-3.5 text-right text-zinc-300">{c.total_orders}</td>
                  <td className="px-6 py-3.5 text-right font-medium text-white">{fmt(c.total_spend, true)}</td>
                </ClickableRow>
              )
            })}
          </tbody>
        </table>

        {totalPages > 1 && (() => {
          // Build a query string once, omitting `page` which we splice in
          // per Prev/Next button. Cleaner than the inline ternary mess.
          const base = new URLSearchParams()
          if (q) base.set('q', q)
          if (campaignsParam) base.set('campaigns', campaignsParam)
          if (storesParam) base.set('stores', storesParam)
          const linkFor = (p: number) => {
            const u = new URLSearchParams(base)
            u.set('page', String(p))
            return `/customers?${u.toString()}`
          }
          return (
            <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800">
              <p className="text-xs text-zinc-500">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link href={linkFor(page - 1)} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs text-white rounded-md transition-colors">
                    ← Prev
                  </Link>
                )}
                {page < totalPages && (
                  <Link href={linkFor(page + 1)} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs text-white rounded-md transition-colors">
                    Next →
                  </Link>
                )}
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
