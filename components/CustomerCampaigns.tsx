'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'

type CampaignDetail = { campaign_name: string; campaign_id: number; legacy_code: string; source: string }
type OrderLine = {
  product_name: string
  variant_name: string | null
  quantity: number
  price_paid: number | null
  order_id: string
  purchase_type: string
}

function fmt(n: number | string | null, currency = false) {
  if (n === null || n === undefined) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  if (currency) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(num)
  return new Intl.NumberFormat('en-US').format(num)
}

function OrdersTable({ lines }: { lines: OrderLine[] }) {
  if (lines.length === 0) {
    return <p className="px-8 py-4 text-xs text-zinc-500">No order details found for this campaign.</p>
  }

  const isIsod = lines.every(l => l.purchase_type === 'isod')

  if (isIsod) {
    return (
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-800/50">
            <th className="text-left px-8 py-2 text-zinc-500 font-medium">Order Ref</th>
            <th className="text-left px-4 py-2 text-zinc-500 font-medium">Date</th>
            <th className="text-right px-6 py-2 text-zinc-500 font-medium">
              <span className="inline-flex px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-600 font-normal">No pricing data</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const parts = line.variant_name?.split(' · ') ?? []
            const ref = parts[0] ?? line.order_id
            const date = parts[1] ?? '—'
            return (
              <tr key={i} className="border-b border-zinc-800/30 last:border-0">
                <td className="px-8 py-2.5 font-mono text-zinc-300">{ref}</td>
                <td className="px-4 py-2.5 text-zinc-500">{date}</td>
                <td className="px-6 py-2.5 text-right text-zinc-600 italic">ISOD 95</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-zinc-800/50">
          <th className="text-left px-8 py-2 text-zinc-500 font-medium">Product</th>
          <th className="text-left px-4 py-2 text-zinc-500 font-medium">Variant</th>
          <th className="text-right px-4 py-2 text-zinc-500 font-medium">Qty</th>
          <th className="text-right px-6 py-2 text-zinc-500 font-medium">Price</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, i) => (
          <tr key={i} className="border-b border-zinc-800/30 last:border-0">
            <td className="px-8 py-2.5 text-zinc-300">{line.product_name}</td>
            <td className="px-4 py-2.5 text-zinc-500">{line.variant_name || '—'}</td>
            <td className="px-4 py-2.5 text-right text-zinc-400">{line.quantity}</td>
            <td className="px-6 py-2.5 text-right text-zinc-300">
              {line.price_paid !== null ? fmt(line.price_paid, true) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function CustomerCampaigns({
  campaigns,
  email,
  initialCampaignId,
}: {
  campaigns: CampaignDetail[]
  email: string
  initialCampaignId?: number
}) {
  const [tab, setTab] = useState<'this' | 'all'>(initialCampaignId ? 'this' : 'all')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [orders, setOrders] = useState<Record<number, OrderLine[]>>({})
  const [fetchErrors, setFetchErrors] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState<number | null>(null)
  const supabase = createClient()

  const focusCampaign = initialCampaignId
    ? campaigns.find(c => c.campaign_id === initialCampaignId)
    : undefined

  async function fetchOrders(campaignId: number) {
    if (orders[campaignId] !== undefined) return
    setLoading(campaignId)
    try {
      const { data, error } = await supabase.rpc('get_customer_campaign_orders', {
        p_email: email,
        p_campaign_id: campaignId,
      })
      if (error) {
        console.error('[fetchOrders] Supabase RPC error for campaign', campaignId, error)
        setFetchErrors(prev => ({ ...prev, [campaignId]: `${error.code ?? ''}: ${error.message}` }))
        setOrders(prev => ({ ...prev, [campaignId]: [] }))
      } else {
        console.log('[fetchOrders] campaign', campaignId, 'rows:', data?.length ?? 0, data)
        setOrders(prev => ({ ...prev, [campaignId]: (data ?? []) as OrderLine[] }))
      }
    } finally {
      setLoading(null)
    }
  }

  // Auto-load orders for the focus campaign when on "this" tab
  useEffect(() => {
    if (initialCampaignId && tab === 'this') {
      fetchOrders(initialCampaignId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCampaignId, tab])

  async function toggleCampaign(campaignId: number) {
    if (expanded === campaignId) {
      setExpanded(null)
      return
    }
    setExpanded(campaignId)
    fetchOrders(campaignId)
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
      {/* Tab bar — only show tabs when arriving from a campaign */}
      {focusCampaign ? (
        <div className="flex items-center px-6 pt-4 border-b border-zinc-800 gap-1">
          <button
            onClick={() => setTab('this')}
            className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
              tab === 'this'
                ? 'text-white border-b-2 border-white pb-[calc(0.5rem-2px)]'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {focusCampaign.campaign_name}
          </button>
          <button
            onClick={() => setTab('all')}
            className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
              tab === 'all'
                ? 'text-white border-b-2 border-white pb-[calc(0.5rem-2px)]'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            All Campaigns
          </button>
        </div>
      ) : (
        <div className="px-6 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-white">Campaigns Supported</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Click a campaign to see what was ordered</p>
        </div>
      )}

      {/* This Campaign tab */}
      {focusCampaign && tab === 'this' && (
        <div>
          <div className="px-6 py-3 border-b border-zinc-800/50 bg-zinc-950/40">
            <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium">{focusCampaign.campaign_name}</p>
          </div>
          {loading === initialCampaignId ? (
            <p className="px-8 py-6 text-xs text-zinc-500 animate-pulse">Loading orders…</p>
          ) : fetchErrors[initialCampaignId!] ? (
            <p className="px-8 py-6 text-xs text-red-400">Error: {fetchErrors[initialCampaignId!]}</p>
          ) : orders[initialCampaignId!] !== undefined ? (
            <OrdersTable lines={orders[initialCampaignId!]} />
          ) : (
            <p className="px-8 py-6 text-xs text-zinc-500 animate-pulse">Loading orders…</p>
          )}
        </div>
      )}

      {/* All Campaigns tab (or default when no focus campaign) */}
      {(!focusCampaign || tab === 'all') && (
        <>
          {!focusCampaign && (
            <div></div>
          )}
          {campaigns.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Campaign</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Code</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Source</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((camp) => (
                  <>
                    <tr
                      key={camp.campaign_id}
                      onClick={() => toggleCampaign(camp.campaign_id)}
                      className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors cursor-pointer"
                    >
                      <td className="px-6 py-3.5 font-medium text-white">{camp.campaign_name}</td>
                      <td className="px-6 py-3.5 text-zinc-400 font-mono text-xs">{camp.legacy_code}</td>
                      <td className="px-6 py-3.5">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-300 capitalize">
                          {camp.source}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-zinc-500 text-xs">
                        {loading === camp.campaign_id ? (
                          <span className="animate-pulse">…</span>
                        ) : (
                          <span>{expanded === camp.campaign_id ? '▲' : '▼'}</span>
                        )}
                      </td>
                    </tr>

                    {expanded === camp.campaign_id && (
                      <tr key={`${camp.campaign_id}-orders`} className="border-b border-zinc-800/50 bg-zinc-950/60">
                        <td colSpan={4} className="px-0 py-0">
                          {loading === camp.campaign_id ? (
                            <p className="px-8 py-4 text-xs text-zinc-500 animate-pulse">Loading orders…</p>
                          ) : fetchErrors[camp.campaign_id] ? (
                            <p className="px-8 py-4 text-xs text-red-400">Error: {fetchErrors[camp.campaign_id]}</p>
                          ) : orders[camp.campaign_id] !== undefined ? (
                            <OrdersTable lines={orders[camp.campaign_id]} />
                          ) : (
                            <p className="px-8 py-4 text-xs text-zinc-500">No order details found.</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-6 py-8 text-center text-zinc-500 text-sm">No campaigns found</p>
          )}
        </>
      )}
    </div>
  )
}
