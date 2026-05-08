import { getCampaignStats } from '@/lib/supabase'
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
  const campaigns = await getCampaignStats()

  const totalRevenue = campaigns.reduce((s, c) => s + Number(c.total_spend), 0)
  const totalBackers = campaigns.reduce((s, c) => s + Number(c.total_customers), 0)

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-semibold text-white">Campaigns</h1>
        <p className="text-sm text-zinc-500 mt-1">
          {campaigns.length} campaigns · {fmt(totalBackers)} total backers · {fmt(totalRevenue, true)} total revenue
        </p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Campaign</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Backers</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Orders</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Revenue</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Avg / Backer</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <ClickableRow
                key={c.campaign_id}
                href={`/campaigns/${c.campaign_id}`}
                className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
              >
                <td className="px-6 py-4">
                  <Link
                    href={`/campaigns/${c.campaign_id}`}
                    className="font-medium text-white hover:text-zinc-300 transition-colors"
                  >
                    {c.campaign_name}
                  </Link>
                </td>
                <td className="px-6 py-4 text-right text-zinc-300">{fmt(c.total_customers)}</td>
                <td className="px-6 py-4 text-right text-zinc-300">{fmt(c.total_orders)}</td>
                <td className="px-6 py-4 text-right font-medium text-white">{fmt(c.total_spend, true)}</td>
                <td className="px-6 py-4 text-right text-zinc-300">
                  {c.total_spend !== null && c.total_customers > 0
                    ? fmt(c.total_spend / c.total_customers, true)
                    : '—'}
                </td>
              </ClickableRow>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
