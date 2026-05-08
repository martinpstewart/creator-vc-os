import { Suspense } from 'react'
import { getCampaignStats, getCampaignBackerList, getCampaignUnitsSold } from '@/lib/supabase'
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

  // Both of these are cached in the data layer — page shell paints fast.
  const [allStats, unitsSold] = await Promise.all([
    getCampaignStats(),
    getCampaignUnitsSold(campaignId),
  ])

  const campaign = allStats.find(c => c.campaign_id === campaignId)
  if (!campaign) notFound()

  const avgSpend = campaign.total_spend !== null && campaign.total_customers > 0
    ? campaign.total_spend / campaign.total_customers
    : null
  const totalUnits = unitsSold.length > 0
    ? unitsSold.reduce((s, u) => s + Number(u.total_quantity), 0)
    : null
  const distinctProducts = new Set(unitsSold.map(u => u.product_name)).size

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

      {/* Tabbed Products / Backers — backers stream in independently */}
      <CampaignDetailTabs
        unitsSold={unitsSold}
        productCount={distinctProducts}
        backerCount={campaign.total_customers}
        backersSlot={
          <Suspense fallback={<SkeletonRows rows={6} />}>
            <BackersSlot campaignId={campaignId} />
          </Suspense>
        }
      />
    </div>
  )
}
