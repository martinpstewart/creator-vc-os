import { getCustomers, getCampaigns } from '@/lib/supabase'
import Link from 'next/link'
import { Suspense } from 'react'
import CampaignFilter from '@/components/CampaignFilter'
import CustomerSearch from '@/components/CustomerSearch'
import ClickableRow from '@/components/ClickableRow'

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
  searchParams: Promise<{ q?: string; page?: string; campaigns?: string }>
}) {
  const { q, page: pageStr, campaigns: campaignsParam } = await searchParams
  const page = parseInt(pageStr ?? '1')
  const selectedIds = campaignsParam
    ? campaignsParam.split(',').map(Number).filter(Boolean)
    : []

  const [{ customers, total }, campaigns] = await Promise.all([
    getCustomers(q, page, 50, selectedIds.length > 0 ? selectedIds : undefined),
    getCampaigns(),
  ])
  const totalPages = Math.ceil(total / 50)

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-white">Customers</h1>
          <p className="text-sm text-zinc-500 mt-1">{fmt(total)} total</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
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

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800">
            <p className="text-xs text-zinc-500">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={`/customers?${q ? `q=${q}&` : ''}${campaignsParam ? `campaigns=${campaignsParam}&` : ''}page=${page - 1}`} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs text-white rounded-md transition-colors">
                  ← Prev
                </Link>
              )}
              {page < totalPages && (
                <Link href={`/customers?${q ? `q=${q}&` : ''}${campaignsParam ? `campaigns=${campaignsParam}&` : ''}page=${page + 1}`} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs text-white rounded-md transition-colors">
                  Next →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
