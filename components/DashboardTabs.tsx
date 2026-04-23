'use client'

import { useState } from 'react'
import Link from 'next/link'

function fmt(n: number | string | null, currency = false) {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  if (currency) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num)
  return new Intl.NumberFormat('en-US').format(num)
}

type Customer = {
  email: string
  full_name: string | null
  total_orders: number
  total_spend: string | number
  is_backer: boolean
}

type CampaignStat = {
  campaign_id: number
  campaign_name: string
  total_customers: number
  total_spend: number
  total_orders: number
}

export default function DashboardTabs({
  customers,
  campaignStats,
}: {
  customers: Customer[]
  campaignStats: CampaignStat[]
}) {
  const [tab, setTab] = useState<'customers' | 'campaigns'>('customers')

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
      {/* Tab bar */}
      <div className="flex items-center justify-between px-6 pt-4 border-b border-zinc-800">
        <div className="flex gap-1">
          {(['customers', 'campaigns'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors capitalize ${
                tab === t
                  ? 'text-white border-b-2 border-white pb-[calc(0.5rem-2px)]'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === 'customers' && (
          <Link href="/customers" className="text-xs text-zinc-400 hover:text-white transition-colors pb-4">
            View all →
          </Link>
        )}
      </div>

      {/* Customers tab */}
      {tab === 'customers' && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Customer</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Email</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Orders</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Total Spent</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Backer</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.email} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                <td className="px-6 py-3.5">
                  <Link href={`/customers/${encodeURIComponent(c.email)}`} className="font-medium text-white hover:text-zinc-300">
                    {c.full_name || '—'}
                  </Link>
                </td>
                <td className="px-6 py-3.5 text-zinc-400">{c.email}</td>
                <td className="px-6 py-3.5 text-right text-zinc-300">{c.total_orders}</td>
                <td className="px-6 py-3.5 text-right font-medium text-white">{fmt(c.total_spend, true)}</td>
                <td className="px-6 py-3.5">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    c.is_backer ? 'bg-green-900/40 text-green-400' : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {c.is_backer ? 'Backer' : 'Pending'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Campaigns tab */}
      {tab === 'campaigns' && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Campaign</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Customers</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Orders</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Total Revenue</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Avg. per Customer</th>
            </tr>
          </thead>
          <tbody>
            {campaignStats.map((c) => (
              <tr key={c.campaign_id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                <td className="px-6 py-4 font-medium text-white">
                  <Link href={`/campaigns/${c.campaign_id}`} className="hover:text-zinc-300 transition-colors">
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
