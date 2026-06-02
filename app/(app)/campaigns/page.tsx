import {
  getCampaigns,
  getCampaignStats,
  getCampaignsHistoricTotals,
  getPayingCustomerCount,
} from '@/lib/supabase'
import { getCurrentRole } from '@/lib/auth-server'
import Link from 'next/link'
import ClickableRow from '@/components/ClickableRow'
import NewCampaignButton from '@/components/NewCampaignButton'

export const dynamic = 'force-dynamic'

function fmt(n: number | string | null, currency = false) {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  if (currency) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num)
  return new Intl.NumberFormat('en-US').format(num)
}

export default async function CampaignsPage() {
  // Three data sources, all aggregated separately at the DB layer:
  //   - getCampaigns()                  → canonical list (id, name, legacy_code)
  //   - getCampaignStats()              → live Shopify aggregation (only
  //                                       campaigns with orders appear here)
  //   - getCampaignsHistoricTotals()    → Gumroad / shopify_legacy / Wix
  //
  // We start from the canonical list so a freshly-created campaign with
  // zero orders still appears (otherwise the stats RPC is the implicit
  // gate on visibility, which is wrong now that users can create
  // campaigns from the UI).
  //
  // Role decides whether revenue columns appear at all — team/support
  // get backers + orders only.
  const [allCampaigns, liveStats, historicTotals, role, payingCustomers] = await Promise.all([
    getCampaigns(),
    getCampaignStats(),
    getCampaignsHistoricTotals(),
    getCurrentRole(),
    // Canonical paying-customer count — used for the header total so
    // it matches /home and /customers. Summing per-campaign rows would
    // over-count cross-campaign buyers.
    getPayingCustomerCount(),
  ])
  const showRevenue = role === 'admin'

  const liveById = new Map(liveStats.map((s) => [s.campaign_id, s]))
  const historicById = new Map(historicTotals.map((h) => [h.campaign_id, h]))

  const rows = allCampaigns.map((c) => {
    const live = liveById.get(c.id)
    const h = historicById.get(c.id)
    const live_revenue   = Number(live?.total_spend ?? 0)
    const live_orders    = Number(live?.total_orders ?? 0)
    const live_customers = Number(live?.total_customers ?? 0)
    const h_revenue   = h ? Number(h.revenue) : 0
    const h_orders    = h ? Number(h.orders) : 0
    const h_customers = h ? Number(h.unique_customers) : 0
    return {
      campaign_id: c.id,
      campaign_name: c.name,
      revenue: live_revenue + h_revenue,
      orders: live_orders + h_orders,
      // Customer count sums per-source dedupes — slight over-count if a
      // buyer appears in both live and historic for the same campaign.
      // The detail page makes the per-platform breakdown explicit.
      customers: live_customers + h_customers,
      has_historic: !!h,
    }
  })

  // Sort: campaigns with activity first (by revenue desc), then empty
  // ones at the bottom. New campaigns will sit at the foot until they
  // pick up their first order.
  rows.sort((a, b) => b.revenue - a.revenue || a.campaign_name.localeCompare(b.campaign_name))

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
  // totalBackers comes from the canonical paying-customer view, NOT
  // the sum of per-campaign rows below — those sum to a higher number
  // because anyone who backs multiple campaigns is counted in each.
  const totalBackers = payingCustomers

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-white">Campaigns</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {rows.length} campaigns · {fmt(totalBackers)} unique backers
            {showRevenue && <> · {fmt(totalRevenue, true)} total revenue</>}
          </p>
          {/* Cross-campaign buyers are counted in each campaign's row
              below, so per-row backer counts can sum higher than the
              unique total above. */}
        </div>
        <NewCampaignButton />
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
