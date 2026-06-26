'use client'

import { useState, type ReactNode } from 'react'

type ProductRow = {
  product_name: string
  variant_name: string | null
  source_platform: string
  units: number | string
  revenue: number | string
}

function fmt(n: number | string | null) {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  return new Intl.NumberFormat('en-US').format(num)
}
function fmtUsd(n: number | string | null) {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (!Number.isFinite(num)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(num)
}

const SOURCE_LABEL: Record<string, string> = {
  shopify: 'Shopify',
  shopify_legacy: 'Shopify (legacy)',
  gumroad: 'Gumroad',
  wix: 'Wix',
  isod: 'ISOD',
}
function sourceLabel(s: string): string {
  return SOURCE_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1)
}
// Subtle per-source tint so Robin can scan and group at a glance.
// Live Shopify stays neutral; everything else gets a quiet badge.
function sourceBadgeClass(s: string): string {
  switch (s) {
    case 'shopify':         return 'bg-zinc-800 text-zinc-300'
    case 'shopify_legacy':  return 'bg-amber-900/40 text-amber-200'
    case 'gumroad':         return 'bg-emerald-900/40 text-emerald-200'
    case 'wix':             return 'bg-purple-900/40 text-purple-200'
    case 'isod':            return 'bg-blue-900/40 text-blue-200'
    default:                return 'bg-zinc-800 text-zinc-400'
  }
}

type Tab = 'products' | 'backers' | 'orders'

export default function CampaignDetailTabs({
  products,
  productCount,
  backerCount,
  orderCount,
  backersSlot,
  ordersSlot,
  ordersToolbar,
  showRevenue,
}: {
  products: ProductRow[]
  productCount: number
  backerCount: number
  orderCount: number
  backersSlot: ReactNode
  ordersSlot: ReactNode
  ordersToolbar: ReactNode
  showRevenue: boolean
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
          count={backerCount}
        />
        <TabButton
          active={tab === 'orders'}
          onClick={() => setTab('orders')}
          label="Orders"
          count={orderCount}
        />
      </div>

      {/* Panels */}
      <div role="tabpanel" hidden={tab !== 'products'}>
        {tab === 'products' && <ProductsPanel products={products} showRevenue={showRevenue} />}
      </div>
      <div role="tabpanel" hidden={tab !== 'backers'}>
        {/* Server-rendered Suspense slot — streams in independently */}
        {backersSlot}
      </div>
      <div role="tabpanel" hidden={tab !== 'orders'}>
        {/* Toolbar (product multi-select + date range) renders alongside
            the table so URL-driven filter changes stay snappy. */}
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:flex-wrap gap-3">
          {ordersToolbar}
        </div>
        {ordersSlot}
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

function ProductsPanel({
  products,
  showRevenue,
}: {
  products: ProductRow[]
  showRevenue: boolean
}) {
  if (products.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-12 text-center text-sm text-zinc-500">
        No product data for this campaign.
      </div>
    )
  }

  const totalUnits = products.reduce((s, p) => s + Number(p.units || 0), 0)
  const totalRevenue = products.reduce((s, p) => s + Number(p.revenue || 0), 0)

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Product</th>
            <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Variant</th>
            <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Source</th>
            <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Units</th>
            {showRevenue && (
              <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Revenue</th>
            )}
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => (
            <tr key={i} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30 transition-colors">
              <td className="px-6 py-3.5 font-medium text-white">{p.product_name}</td>
              <td className="px-6 py-3.5 text-zinc-400">{p.variant_name || '—'}</td>
              <td className="px-6 py-3.5">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${sourceBadgeClass(p.source_platform)}`}>
                  {sourceLabel(p.source_platform)}
                </span>
              </td>
              <td className="px-6 py-3.5 text-right text-zinc-300 font-medium tabular-nums">{fmt(p.units)}</td>
              {showRevenue && (
                <td className="px-6 py-3.5 text-right text-zinc-200 tabular-nums">{fmtUsd(p.revenue)}</td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-zinc-800 bg-zinc-950/40">
            <td className="px-6 py-3 text-xs text-zinc-500 uppercase tracking-wide font-medium" colSpan={3}>
              Total
            </td>
            <td className="px-6 py-3 text-right text-white font-semibold tabular-nums">{fmt(totalUnits)}</td>
            {showRevenue && (
              <td className="px-6 py-3 text-right text-white font-semibold tabular-nums">{fmtUsd(totalRevenue)}</td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
