import { Suspense } from 'react'
import {
  getCampaignStats,
  getCampaignBackerList,
  getCampaignUnitsSold,
  getCampaignHistoricBreakdown,
  getCampaignHistoricUnitsSold,
  type HistoricBreakdownRow,
} from '@/lib/supabase'
import { getCurrentRole } from '@/lib/auth-server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import CampaignExports from '@/components/CampaignExports'
import CampaignDetailTabs from '@/components/CampaignDetailTabs'
import CampaignBackers from '@/components/CampaignBackers'
import { SkeletonRows } from '@/components/Skeleton'

export const dynamic = 'force-dynamic'

function fmt(n: number | string | null, currency = false) {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  if (currency) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num)
  return new Intl.NumberFormat('en-US').format(num)
}

// Streamed inside the page via Suspense — initial 100 backers fetch is the
// slowest call on this route (no PostgREST cache), so we let the rest of
// the page paint first.
async function BackersSlot({ campaignId }: { campaignId: number }) {
  const { backers, total } = await getCampaignBackerList(campaignId, 1, 100)
  return <CampaignBackers campaignId={campaignId} initialBackers={backers} initialTotal={total} />
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const campaignId = parseInt(id, 10)
  if (isNaN(campaignId)) notFound()

  // Defensive: every per-RPC fetch falls back to an empty/null result
  // instead of throwing the whole page into the error boundary. This
  // is what /tickets does too — a single transient backend hiccup
  // shouldn't blank the entire campaign detail. Failures are logged
  // for diagnosis; the user sees a partially-populated page rather
  // than "Something went wrong".
  const [allStats, unitsSoldLive, historicBreakdown, historicUnitsSold, role] =
    await Promise.all([
      getCampaignStats().catch((e) => {
        console.error('[campaigns/[id]] getCampaignStats failed', e)
        return []
      }),
      getCampaignUnitsSold(campaignId).catch((e) => {
        console.error('[campaigns/[id]] getCampaignUnitsSold failed', e)
        return []
      }),
      getCampaignHistoricBreakdown(campaignId).catch((e): HistoricBreakdownRow[] => {
        console.error('[campaigns/[id]] getCampaignHistoricBreakdown failed', e)
        return []
      }),
      getCampaignHistoricUnitsSold(campaignId).catch((e) => {
        console.error('[campaigns/[id]] getCampaignHistoricUnitsSold failed', e)
        return []
      }),
      getCurrentRole(),
    ])
  const showRevenue = role === 'admin'

  // Merge live + historic into one Products list. Live rows have a
  // variant_name from the v_raw_order_line_attribution resolver; historic
  // rows have a NULL variant_name and a source_platform suffix tag in the
  // display name so they can be distinguished at a glance.
  const unitsSold = [
    ...unitsSoldLive,
    ...historicUnitsSold.map((r) => ({
      product_name: r.product_name,
      variant_name: r.variant_name ?? `${labelForSource(r.source_platform)} (historic)`,
      total_quantity: r.total_quantity,
    })),
  ]

  const campaign = allStats.find(c => c.campaign_id === campaignId)
  if (!campaign) notFound()

  // Sum historic rollups across platforms. Customer count is the
  // per-platform sum (slight over-count if a buyer appears in multiple
  // historic sources — acceptable; the per-platform table below makes
  // the breakdown clear).
  const historicTotals = historicBreakdown.reduce(
    (acc, r) => {
      acc.orders += Number(r.orders)
      acc.customers += Number(r.unique_customers)
      acc.revenue += Number(r.revenue)
      acc.units += Number(r.units)
      return acc
    },
    { orders: 0, customers: 0, revenue: 0, units: 0 },
  )

  // Combined headline figures: live (from v_raw_order_line_attribution
  // via get_campaign_stats_v2) PLUS historic.
  const combinedRevenue   = Number(campaign.total_spend ?? 0) + historicTotals.revenue
  const combinedOrders    = Number(campaign.total_orders ?? 0) + historicTotals.orders
  const combinedBackers   = Number(campaign.total_customers ?? 0) + historicTotals.customers
  const avgSpend = combinedRevenue > 0 && combinedBackers > 0
    ? combinedRevenue / combinedBackers
    : null
  const liveUnits = unitsSold.length > 0
    ? unitsSold.reduce((s, u) => s + Number(u.total_quantity), 0)
    : 0
  const totalUnits = liveUnits + historicTotals.units
  const distinctProducts = new Set(unitsSold.map(u => u.product_name)).size

  return (
    <div className="p-4 md:p-8">
      <div className="mb-4 md:mb-6">
        <Link href="/campaigns" className="text-xs text-zinc-500 hover:text-white transition-colors">
          ← Campaigns
        </Link>
      </div>

      <div className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-semibold text-white">{campaign.campaign_name}</h1>
        <p className="text-sm text-zinc-500 mt-1">{fmt(combinedOrders)} orders</p>
      </div>

      {/* KPI cards — figures combine live (Shopify webhook) + historic
          (Gumroad/shopify_legacy/Wix imports). Per-platform breakdown
          rendered below if any historic activity exists.
          For non-admin (team/support) the two revenue tiles are dropped
          and the grid collapses to two columns. */}
      <div
        className={`grid grid-cols-2 gap-3 md:gap-4 mb-6 md:mb-8 ${
          showRevenue ? 'md:grid-cols-4' : 'md:grid-cols-2'
        }`}
      >
        {showRevenue && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5">
            <p className="text-[11px] md:text-xs text-zinc-500 uppercase tracking-wide font-medium">Total Revenue</p>
            <p className="text-xl md:text-2xl font-semibold text-white mt-2">{fmt(combinedRevenue, true)}</p>
          </div>
        )}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5">
          <p className="text-[11px] md:text-xs text-zinc-500 uppercase tracking-wide font-medium">Unique Backers</p>
          <p className="text-xl md:text-2xl font-semibold text-white mt-2">{fmt(combinedBackers)}</p>
        </div>
        {showRevenue && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5">
            <p className="text-[11px] md:text-xs text-zinc-500 uppercase tracking-wide font-medium">Avg per Backer</p>
            <p className="text-xl md:text-2xl font-semibold text-white mt-2">{fmt(avgSpend, true)}</p>
          </div>
        )}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5">
          <p className="text-[11px] md:text-xs text-zinc-500 uppercase tracking-wide font-medium">Units Sold</p>
          <p className="text-xl md:text-2xl font-semibold text-white mt-2">{fmt(totalUnits)}</p>
        </div>
      </div>

      {/* Historic breakdown — only renders if this campaign has imported
          orders. For campaign 5 (TerrorBytes) this IS the campaign;
          for campaigns 3 / 1 it supplements the live numbers. */}
      {historicBreakdown.length > 0 && (
        <HistoricOrdersBreakdown rows={historicBreakdown} showRevenue={showRevenue} />
      )}

      {/* Export buttons */}
      <div className="mb-6 md:mb-8">
        <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium mb-3">Export</p>
        <CampaignExports campaignId={campaignId} campaignName={campaign.campaign_name} />
      </div>

      {/* Tabbed Products / Backers — both lists merge live + historic. */}
      <CampaignDetailTabs
        unitsSold={unitsSold}
        productCount={distinctProducts}
        backerCount={combinedBackers}
        backersSlot={
          <Suspense fallback={<SkeletonRows rows={6} />}>
            <BackersSlot campaignId={campaignId} />
          </Suspense>
        }
      />
    </div>
  )
}

// Per-platform rollup over historic_orders for one campaign. Shopify (legacy)
// gets the friendly label; the others use a capitalised version of the raw
// source_platform value.
const HISTORIC_LABEL: Record<string, string> = {
  shopify_legacy: 'Shopify (legacy)',
  gumroad: 'Gumroad',
  wix: 'Wix',
}
function labelForSource(s: string): string {
  return HISTORIC_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1)
}
function HistoricOrdersBreakdown({
  rows,
  showRevenue,
}: {
  rows: HistoricBreakdownRow[]
  showRevenue: boolean
}) {
  return (
    <section className="mb-6 md:mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium">
          Historic orders — by platform
        </p>
        <p className="text-[11px] text-zinc-600">
          From CSV imports. Live Shopify webhook orders are counted above the table.
        </p>
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-950/40">
              <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                Platform
              </th>
              <th className="text-right px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                Orders
              </th>
              <th className="text-right px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                Customers
              </th>
              {showRevenue && (
                <th className="text-right px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                  Revenue
                </th>
              )}
              <th className="text-right px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                Units
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source_platform} className="border-b border-zinc-800/50 last:border-0">
                <td className="px-5 py-3 text-zinc-200">
                  {HISTORIC_LABEL[r.source_platform] ??
                    r.source_platform.charAt(0).toUpperCase() + r.source_platform.slice(1)}
                </td>
                <td className="px-5 py-3 text-right text-zinc-200 tabular-nums">{fmt(r.orders)}</td>
                <td className="px-5 py-3 text-right text-zinc-300 tabular-nums">{fmt(r.unique_customers)}</td>
                {showRevenue && (
                  <td className="px-5 py-3 text-right text-zinc-200 tabular-nums">{fmt(r.revenue, true)}</td>
                )}
                <td className="px-5 py-3 text-right text-zinc-300 tabular-nums">{fmt(r.units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
