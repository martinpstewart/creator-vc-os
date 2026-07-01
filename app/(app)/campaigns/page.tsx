import { getCampaignsList } from '@/lib/supabase'
import { getCurrentRole } from '@/lib/auth-server'
import Link from 'next/link'
import { Clapperboard } from 'lucide-react'
import ClickableRow from '@/components/ClickableRow'
import NewCampaignButton from '@/components/NewCampaignButton'

export const dynamic = 'force-dynamic'
// get_campaigns_list is a sub-10ms snapshot read, so the page is
// normally fast. The 60s bump is belt-and-braces for serverless cold
// starts on Vercel Hobby (which silently caps at 10s).
export const maxDuration = 60

function fmt(n: number | string | null, currency = false) {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  if (currency) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num)
  return new Intl.NumberFormat('en-US').format(num)
}

export default async function CampaignsPage() {
  // Single snapshot fetch: aa_02_crm.campaigns_list_snapshot already
  // merges v3 stats + historic totals + canonical campaign list + the
  // canonical paying-customer count for the header. Refreshed every 10
  // min by pg_cron. Replaces what used to be 5 round-trips.
  //
  // Role decides whether revenue columns appear at all — team/support
  // get backers + orders only.
  const [rows, role] = await Promise.all([
    getCampaignsList(),
    getCurrentRole(),
  ])
  const showRevenue = role === 'admin'

  const totalRevenue = rows.reduce((s, r) => s + Number(r.total_revenue), 0)
  // totalBackers comes from the canonical paying-customer view (same
  // value repeated on every snapshot row), NOT the sum of per-campaign
  // rows below — those sum to a higher number because anyone who backs
  // multiple campaigns is counted in each.
  const totalBackers = rows[0]?.paying_customer_count ?? 0

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
            {showRevenue && (
              <p className="text-[11px] text-zinc-600 mt-1">
                Revenue is the total attributed to each campaign, across every source (live Shopify, live Gumroad, historic imports).
              </p>
            )}
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
            {rows.map((r) => {
              const revenue = Number(r.total_revenue)
              return (
                <ClickableRow
                  key={r.campaign_id}
                  href={`/campaigns/${r.campaign_id}`}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="px-6 py-4">
                    <Link
                      href={`/campaigns/${r.campaign_id}`}
                      className="font-medium text-white hover:text-zinc-300 transition-colors"
                    >
                      {r.campaign_name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-right text-zinc-300">{fmt(r.total_customers)}</td>
                  <td className="px-6 py-4 text-right text-zinc-300">{fmt(r.total_orders)}</td>
                  {showRevenue && (
                    <>
                      <td className="px-6 py-4 text-right font-medium text-white">{fmt(revenue, true)}</td>
                      <td className="px-6 py-4 text-right text-zinc-300">
                        {r.total_customers > 0 ? fmt(revenue / r.total_customers, true) : '—'}
                      </td>
                    </>
                  )}
                </ClickableRow>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
