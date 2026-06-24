import { Suspense } from 'react'
import {
  getCampaignsList,
  getCampaignBackerList,
  getCampaignProducts,
  getCampaignHistoricBreakdown,
  type HistoricBreakdownRow,
} from '@/lib/supabase'
import { getCurrentRole } from '@/lib/auth-server'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import CampaignExports from '@/components/CampaignExports'
import CampaignDetailTabs from '@/components/CampaignDetailTabs'
import CampaignBackers from '@/components/CampaignBackers'
import CustomerSearch from '@/components/CustomerSearch'
import { SkeletonRows } from '@/components/Skeleton'

export const dynamic = 'force-dynamic'
// All three remaining server-side RPCs (campaigns_list_snapshot,
// get_campaign_products_v2, get_campaign_historic_breakdown) read in
// under 600ms warm. The 60s bump is belt-and-braces for cold starts.
export const maxDuration = 60

function fmt(n: number | string | null, currency = false) {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  if (currency) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num)
  return new Intl.NumberFormat('en-US').format(num)
}

// Streamed inside the page via Suspense — even at 50ms warm, letting
// the rest of the page paint first keeps perceived speed up while the
// backers table queries the snapshot.
async function BackersSlot({
  campaignId,
  initialPage,
  initialSearch,
}: {
  campaignId: number
  initialPage: number
  initialSearch: string
}) {
  const { backers, total } = await getCampaignBackerList(
    campaignId,
    initialPage,
    100,
    initialSearch || undefined,
  )
  return (
    <CampaignBackers
      campaignId={campaignId}
      initialBackers={backers}
      initialTotal={total}
      initialPage={initialPage}
      initialSearch={initialSearch}
    />
  )
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const campaignId = parseInt(id, 10)
  if (isNaN(campaignId)) notFound()

  const searchQ = (sp.q ?? '').trim()
  const initialPage = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)

  // Defensive: every per-RPC fetch falls back to an empty/null result
  // instead of throwing the whole page into the error boundary. A
  // single transient backend hiccup shouldn't blank the entire campaign
  // detail. Failures are logged; the user sees a partially-populated
  // page rather than "Something went wrong".
  //
  // Note: we read the campaign headline from campaigns_list_snapshot
  // (0.15ms reader) instead of the old get_campaign_stats_v3 (10s).
  // total_revenue on the snapshot ALREADY combines live Shopify + ISOD
  // + historic CSV imports — we do NOT add historicTotals on top.
  const [allCampaigns, products, historicBreakdown, role] =
    await Promise.all([
      getCampaignsList().catch((e) => {
        console.error('[campaigns/[id]] getCampaignsList failed', e)
        return []
      }),
      getCampaignProducts(campaignId).catch((e) => {
        console.error('[campaigns/[id]] getCampaignProducts failed', e)
        return []
      }),
      getCampaignHistoricBreakdown(campaignId).catch((e): HistoricBreakdownRow[] => {
        console.error('[campaigns/[id]] getCampaignHistoricBreakdown failed', e)
        return []
      }),
      getCurrentRole(),
    ])
  const showRevenue = role === 'admin'

  const campaign = allCampaigns.find((c) => c.campaign_id === campaignId)
  if (!campaign) notFound()

  // Historic breakdown table — separate from the headline tiles, which
  // already include historic in their totals via the snapshot.
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

  const combinedOrders  = Number(campaign.total_orders ?? 0)
  const combinedBackers = Number(campaign.total_customers ?? 0)
  // Snapshot already merges historic + live; do NOT add historicTotals.
  const combinedRevenue = Number(campaign.total_revenue ?? 0)
  const avgSpend = combinedRevenue > 0 && combinedBackers > 0
    ? combinedRevenue / combinedBackers
    : null
  const totalUnits = products.reduce((s, p) => s + Number(p.units || 0), 0)
  const distinctProducts = products.length

  return (
    <div className="p-4 md:p-8">
      <div className="mb-4 md:mb-6">
        <Link href="/campaigns" className="text-xs text-zinc-500 hover:text-white transition-colors">
          ← Campaigns
        </Link>
      </div>

      <div className="mb-6 md:mb-8 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-white">{campaign.campaign_name}</h1>
          <p className="text-sm text-zinc-500 mt-1">{fmt(combinedOrders)} orders</p>
        </div>
        <CustomerSearch defaultValue={searchQ || undefined} />
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

      {historicBreakdown.length > 0 && (
        <HistoricOrdersBreakdown rows={historicBreakdown} showRevenue={showRevenue} totals={historicTotals} />
      )}

      <div className="mb-6 md:mb-8">
        <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium mb-3">Export</p>
        <CampaignExports campaignId={campaignId} campaignName={campaign.campaign_name} />
      </div>

      <CampaignDetailTabs
        products={products}
        productCount={distinctProducts}
        backerCount={combinedBackers}
        showRevenue={showRevenue}
        backersSlot={
          <Suspense fallback={<SkeletonRows rows={6} />}>
            <BackersSlot campaignId={campaignId} initialPage={initialPage} initialSearch={searchQ} />
          </Suspense>
        }
      />
    </div>
  )
}

const HISTORIC_LABEL: Record<string, string> = {
  shopify_legacy: 'Shopify (legacy)',
  gumroad: 'Gumroad',
  wix: 'Wix',
}
function HistoricOrdersBreakdown({
  rows,
  showRevenue,
}: {
  rows: HistoricBreakdownRow[]
  showRevenue: boolean
  totals: { orders: number; customers: number; revenue: number; units: number }
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
