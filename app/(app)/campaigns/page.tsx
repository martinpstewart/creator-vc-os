import {
  getCampaigns,
  getCampaignStats,
  getCampaignsHistoricTotals,
  getPayingCustomerCount,
} from '@/lib/supabase'
import { getCurrentRole } from '@/lib/auth-server'
import Link from 'next/link'
import { Clapperboard } from 'lucide-react'
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
  // Sources:
  //   - getCampaigns()               → canonical list (id, name, legacy_code).
  //                                    Start here so a brand-new zero-order
  //                                    campaign still appears.
  //   - getCampaignStats() / v3      → per-campaign rollup. total_orders +
  //                                    total_customers already cover all
  //                                    paying sources (raw_orders + isod +
  //                                    historic_orders). total_spend covers
  //                                    live Shopify lines + ISOD price_paid.
  //   - getCampaignsHistoricTotals() → historic CSV-import revenue (Gumroad
  //                                    / shopify_legacy / Wix line revenue).
  //                                    Added on top of v3.total_spend, since
  //                                    v3 only carries the live + ISOD slice
  //                                    of revenue.
  //
  // What this means for the row math:
  //   orders    = v3.total_orders                (do NOT add historic — already in v3)
  //   customers = v3.total_customers             (do NOT add historic — already in v3)
  //   revenue   = v3.total_spend + h.revenue     (these slices don't overlap)
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
    // v3.total_orders + v3.total_customers ALREADY include historic
    // (raw_orders + isod_orders + historic_order_lines all rolled in
    // inside the RPC). Do NOT add historic on top — that double-counts.
    // v3.total_spend is live Shopify line-revenue only, so historic
    // revenue does need to be added on top.
    const v3_orders    = Number(live?.total_orders ?? 0)
    const v3_customers = Number(live?.total_customers ?? 0)
    const live_spend   = Number(live?.total_spend ?? 0)
    const h_revenue    = h ? Number(h.revenue) : 0
    const h_orders_for_historic_only = h ? Number(h.orders) : 0
    return {
      campaign_id: c.id,
      campaign_name: c.name,
      revenue: live_spend + h_revenue,
      orders: v3_orders,
      customers: v3_customers,
      // The "+ HISTORIC" badge fires when a campaign has ANY historic
      // contribution. The number is folded into v3.total_orders/total_customers
      // already; the badge just tells the reader the row spans imports.
      has_historic: h_orders_for_historic_only > 0,
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
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-9 h-9 md:w-10 md:h-10 rounded-lg bg-[#3B9EE8] shrink-0">
            <Clapperboard size={18} className="text-white" strokeWidth={2.25} />
          </span>
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
