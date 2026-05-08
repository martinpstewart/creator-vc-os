import { getKPIs, getCustomers, getCampaignStats } from '@/lib/supabase'
import DashboardTabs from '@/components/DashboardTabs'

export const dynamic = 'force-dynamic'

function fmt(n: number | string, currency = false) {
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (currency) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num)
  return new Intl.NumberFormat('en-US').format(num)
}

export default async function DashboardPage() {
  const [kpis, { customers }, campaignStats] = await Promise.all([
    getKPIs(),
    getCustomers(undefined, 1, 10),
    getCampaignStats(),
  ])

  // Roll up KPIs across all campaigns from customer_summary
  const totalRevenue = campaignStats.reduce((s, c) => s + Number(c.total_spend), 0)
  const totalOrders = campaignStats.reduce((s, c) => s + Number(c.total_orders), 0)

  const stats = [
    { label: 'Total Revenue', value: fmt(totalRevenue, true), sub: 'across all campaigns' },
    { label: 'Customers', value: fmt(kpis.total_customers), sub: 'unique backers' },
    { label: 'Total Orders', value: fmt(totalOrders), sub: 'completed orders' },
    { label: 'Campaigns', value: fmt(campaignStats.length), sub: 'active campaigns' },
  ]

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-semibold text-white">Home</h1>
        <p className="text-sm text-zinc-500 mt-1">Overview across all campaigns</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8 md:mb-10">
        {stats.map(({ label, value, sub }) => (
          <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5">
            <p className="text-[11px] md:text-xs text-zinc-500 uppercase tracking-wide font-medium">{label}</p>
            <p className="text-xl md:text-3xl font-semibold text-white mt-2">{value}</p>
            <p className="text-[10px] md:text-xs text-zinc-600 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      <DashboardTabs customers={customers} campaignStats={campaignStats} />
    </div>
  )
}
