import { getCustomerByEmail } from '@/lib/supabase'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import CustomerCampaigns from '@/components/CustomerCampaigns'

function fmt(n: number | string | null, currency = false) {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  if (currency) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(num)
  return new Intl.NumberFormat('en-US').format(num)
}

type CampaignDetail = { campaign_name: string; campaign_id: number; legacy_code: string; source: string }

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ email: string }>
  searchParams: Promise<{ campaign?: string }>
}) {
  const [{ email: encodedEmail }, sp] = await Promise.all([params, searchParams])
  const email = decodeURIComponent(encodedEmail)
  const fromCampaignId = sp.campaign ? parseInt(sp.campaign, 10) : undefined

  const customer = await getCustomerByEmail(email).catch(() => null)
  if (!customer) notFound()

  const allCampaigns: CampaignDetail[] = [
    ...((customer.campaign_orders_detail as CampaignDetail[]) ?? []),
    ...((customer.raw_orders_detail as CampaignDetail[]) ?? []),
    ...((customer.isod_orders_detail as CampaignDetail[]) ?? []),
  ]
  const campaigns = [...new Map(allCampaigns.map(x => [x.campaign_id, x])).values()]

  const addressLines = [
    customer.shipping_address_1,
    customer.shipping_address_2,
    [customer.shipping_city, customer.shipping_zip].filter(Boolean).join(' '),
    customer.shipping_country,
  ].filter(Boolean)

  const fromCampaign = fromCampaignId
    ? campaigns.find(c => c.campaign_id === fromCampaignId)
    : undefined

  return (
    <div className="p-8">
      <div className="mb-6">
        {fromCampaign ? (
          <Link
            href={`/campaigns/${fromCampaignId}`}
            className="text-xs text-zinc-500 hover:text-white transition-colors"
          >
            ← {fromCampaign.campaign_name}
          </Link>
        ) : (
          <Link href="/customers" className="text-xs text-zinc-500 hover:text-white transition-colors">
            ← Customers
          </Link>
        )}
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">{customer.full_name || email}</h1>
        <p className="text-sm text-zinc-500 mt-1">{email}{customer.phone ? ` · ${customer.phone}` : ''}</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium">Total Spent</p>
          <p className="text-2xl font-semibold text-white mt-2">{fmt(customer.total_spend, true)}</p>
          <p className="text-xs text-zinc-600 mt-1">{customer.total_line_items} line items · {customer.total_quantity_purchased} units</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium">Orders</p>
          <p className="text-2xl font-semibold text-white mt-2">{customer.total_orders}</p>
          <p className="text-xs text-zinc-600 mt-1">
            {[
              customer.has_campaign_orders && 'campaign',
              customer.has_raw_orders && 'direct',
              customer.has_isod_orders && 'ISOD',
            ].filter(Boolean).join(' · ') || 'no orders'}
          </p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium">Shipping Address</p>
          {addressLines.length > 0 ? (
            <div className="mt-2 space-y-0.5">
              {addressLines.map((line, i) => (
                <p key={i} className="text-sm text-white">{line}</p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500 mt-2">No address on file</p>
          )}
        </div>
      </div>

      {/* Campaigns — expandable rows, auto-opens fromCampaignId if set */}
      <CustomerCampaigns
        campaigns={campaigns}
        email={email}
        initialCampaignId={fromCampaignId}
      />
    </div>
  )
}
