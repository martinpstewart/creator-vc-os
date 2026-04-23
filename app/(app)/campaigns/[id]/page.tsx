import { getCampaignStats, getCampaignBackerList, getCampaignUnitsSold } from '@/lib/supabase'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import CampaignExports from '@/components/CampaignExports'

export const dynamic = 'force-dynamic'

function fmt(n: number | string | null, currency = false) {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  if (currency) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num)
  return new Intl.NumberFormat('en-US').format(num)
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const campaignId = parseInt(id, 10)
  if (isNaN(campaignId)) notFound()

  const [allStats, backers, unitsSold] = await Promise.all([
    getCampaignStats(),
    getCampaignBackerList(campaignId),
    getCampaignUnitsSold(campaignId),
  ])

  const campaign = allStats.find(c => c.campaign_id === campaignId)
  if (!campaign) notFound()

  const avgSpend = campaign.total_customers > 0
    ? campaign.total_spend / campaign.total_customers
    : 0
  const totalUnits = unitsSold.reduce((s, u) => s + Number(u.total_quantity), 0)

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link href="/campaigns" className="text-xs text-zinc-500 hover:text-white transition-colors">
          ← Campaigns
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">{campaign.campaign_name}</h1>
        <p className="text-sm text-zinc-500 mt-1">{fmt(campaign.total_orders)} orders</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium">Total Revenue</p>
          <p className="text-2xl font-semibold text-white mt-2">{fmt(campaign.total_spend, true)}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium">Unique Backers</p>
          <p className="text-2xl font-semibold text-white mt-2">{fmt(campaign.total_customers)}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium">Avg per Backer</p>
          <p className="text-2xl font-semibold text-white mt-2">{fmt(avgSpend, true)}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium">Units Sold</p>
          <p className="text-2xl font-semibold text-white mt-2">{fmt(totalUnits)}</p>
        </div>
      </div>

      {/* Export buttons */}
      <div className="mb-8">
        <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium mb-3">Export</p>
        <CampaignExports campaignId={campaignId} campaignName={campaign.campaign_name} />
      </div>

      {/* Products breakdown */}
      {unitsSold.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl mb-8">
          <div className="px-6 py-4 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-white">Products Sold</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Product</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Variant</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Units Sold</th>
              </tr>
            </thead>
            <tbody>
              {unitsSold.map((u, i) => (
                <tr key={i} className="border-b border-zinc-800/50">
                  <td className="px-6 py-3 text-white">{u.product_name}</td>
                  <td className="px-6 py-3 text-zinc-400">{u.variant_name || '—'}</td>
                  <td className="px-6 py-3 text-right text-zinc-300">{fmt(u.total_quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Backers list */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Backers</h2>
          <span className="text-xs text-zinc-500">{fmt(backers.length)} shown</span>
        </div>
        {backers.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Backer</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Email</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Orders</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Spend</th>
              </tr>
            </thead>
            <tbody>
              {backers.map((b) => (
                <tr key={b.email} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
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
                  <td className="px-6 py-3.5 text-right font-medium text-white">
                    {b.total_spend !== null ? fmt(b.total_spend, true) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-6 py-8 text-center text-zinc-500 text-sm">No backers found</p>
        )}
      </div>
    </div>
  )
}
