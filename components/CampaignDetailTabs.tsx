'use client'

import { useState } from 'react'
import CampaignBackers from './CampaignBackers'

type UnitsSoldRow = {
  product_name: string
  variant_name: string | null
  total_quantity: number | string
}

type BackerRow = {
  email: string
  full_name: string | null
  total_spend: number | null
  order_count: number
  total_count: number
}

function fmt(n: number | string | null) {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  return new Intl.NumberFormat('en-US').format(num)
}

type Tab = 'products' | 'backers'

export default function CampaignDetailTabs({
  campaignId,
  unitsSold,
  productCount,
  initialBackers,
  totalBackers,
}: {
  campaignId: number
  unitsSold: UnitsSoldRow[]
  productCount: number
  initialBackers: BackerRow[]
  totalBackers: number
}) {
  const [tab, setTab] = useState<Tab>('products')

  return (
    <div>
      {/* Tab strip — bold pill buttons in brand blue when active */}
      <div className="flex items-center gap-2 mb-5" role="tablist">
        <TabButton
          active={tab === 'products'}
          onClick={() => setTab('products')}
          label="Products"
          count={productCount}
        />
        <TabButton
          active={tab === 'backers'}
          onClick={() => setTab('backers')}
          label="Backers"
          count={totalBackers}
        />
      </div>

      {/* Panels */}
      <div role="tabpanel" hidden={tab !== 'products'}>
        {tab === 'products' && <ProductsPanel unitsSold={unitsSold} />}
      </div>
      <div role="tabpanel" hidden={tab !== 'backers'}>
        {tab === 'backers' && (
          <CampaignBackers
            campaignId={campaignId}
            initialBackers={initialBackers}
            initialTotal={totalBackers}
          />
        )}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number | null
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`
        group relative flex items-center gap-2.5 px-5 py-2.5 rounded-full
        text-sm font-bold tracking-tight
        transition-all duration-150
        ${
          active
            ? 'bg-[#3B9EE8] text-white shadow-[0_0_0_1px_rgba(59,158,232,0.4),0_4px_20px_-4px_rgba(59,158,232,0.5)]'
            : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-white hover:border-zinc-700 hover:bg-zinc-800/60'
        }
      `}
    >
      <span>{label}</span>
      <span
        className={`
          inline-flex items-center justify-center
          min-w-[1.5rem] h-5 px-1.5 rounded-full
          text-[11px] font-bold tabular-nums
          ${active ? 'bg-white/20 text-white' : 'bg-zinc-800 text-zinc-400 group-hover:bg-zinc-700 group-hover:text-zinc-200'}
        `}
      >
        {count !== null ? fmt(count) : '—'}
      </span>
    </button>
  )
}

function ProductsPanel({ unitsSold }: { unitsSold: UnitsSoldRow[] }) {
  if (unitsSold.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-12 text-center text-sm text-zinc-500">
        No product data for this campaign.
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Product</th>
            <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Variant</th>
            <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Units Sold</th>
          </tr>
        </thead>
        <tbody>
          {unitsSold.map((u, i) => (
            <tr key={i} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30 transition-colors">
              <td className="px-6 py-3.5 font-medium text-white">{u.product_name}</td>
              <td className="px-6 py-3.5 text-zinc-400">{u.variant_name || '—'}</td>
              <td className="px-6 py-3.5 text-right text-zinc-300 font-medium tabular-nums">{fmt(u.total_quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
