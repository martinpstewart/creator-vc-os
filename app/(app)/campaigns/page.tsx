import { getCampaignStats, getCampaignsHistoricTotals } from '@/lib/supabase'
import { getCurrentRole } from '@/lib/auth-server'
import Link from 'next/link'
import ClickableRow from '@/components/ClickableRow'

export const dynamic = 'force-dynamic'

function fmt(n: number | string | null, currency = false) {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  if (currency) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num)
  return new Intl.NumberFormat('en-US').format(num)
}

export default async function CampaignsPage() {
  // Live (Shopify webhook) + historic (Gumroad/shopify_legacy/Wix CSVs)
  // are aggregated separately at the DB layer; combine in JS so the
  // list page matches the detail page's headline numbers.
  // Role decides whether revenue columns appear at all — team/support
  // get backers + orders only.
  const [liveStats, historicTotals, role] = await Promise.all([
    getCampaignStats(),
    getCampaignsHistoricTotals(),
    getCurrentRole(),
  ])
  const showRevenue = role === 'admin'

  const historicById = new Map(historicTotals.map((h) => [h.campaign_id, h]))

  const rows = liveStats.map((c) => {
    const h = historicById.get(c.campaign_id)
    const live_revenue   = Number(c.total_spend ?? 0)
    const live_orders    = Number(c.total_orders ?? 0)
    const live_customers = Number(c.total_customers ?? 0)
    const h_revenue   = h ? Number(h.revenue) : 0
    const h_orders    = h ? Number(h.orders) : 0
    const h_customers = h ? Number(h.unique_customers) : 0
    return {
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      revenue: live_revenue + h_revenue,
      orders: live_orders + h_orders,
      // Customer count sums per-source dedupes — slight over-count if a
      // buyer appears in both live and historic for the same campaign.
      // The detail page makes the per-platform breakdown explicit.
      customers: live_customers + h_customers,
      has_historic: !!h,
    }
  })

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
  const totalBackers = rows.reduce((s, r) => s + r.customers, 0)

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-semibold text-white">Campaigns</h1>
        <p className="text-sm text-zinc-500 mt-1">
          {rows.length} campaigns · {fmt(totalBackers)} total backers
          {showRevenue && <> · {fmt(totalRevenue, true)} total revenue</>}
        </p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Campaign</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Backers</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Orders</th>
              {showRevenue && (
                <>
                  <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Revenue</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Avg / Backer</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <ClickableRow
                key={r.campaign_id}
                href={`/campaigns/${r.campaign_id}`}
                className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
              >
                <td className="px-6 py-4">
                  <Link
                    href={`/campaigns/${r.campaign_id}`}
                    className="font-medium text-white hover:text-zinc-300 transition-colors inline-flex items-center gap-2"
                  >
                    {r.campaign_name}
                    {r.has_historic && (
                      <span
                        className="text-[10px] uppercase tracking-wide font-semibold text-zinc-500 bg-zinc-800/80 px-1.5 py-0.5 rounded"
                        title="Includes historic CSV imports (Gumroad / shopify_legacy / Wix)"
                      >
                        + historic
                      </span>
                    )}
                  </Link>
                </td>
                <td className="px-6 py-4 text-right text-zinc-300">{fmt(r.customers)}</td>
                <td className="px-6 py-4 text-right text-zinc-300">{fmt(r.orders)}</td>
                {showRevenue && (
                  <>
                    <td className="px-6 py-4 text-right font-medium text-white">{fmt(r.revenue, true)}</td>
                    <td className="px-6 py-4 text-right text-zinc-300">
                      {r.customers > 0 ? fmt(r.revenue / r.customers, true) : '—'}
                    </td>
                  </>
                )}
              </ClickableRow>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
