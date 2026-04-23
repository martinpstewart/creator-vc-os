'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

function toCSV(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(',')
  const body = rows.map(row =>
    columns.map(col => {
      const val = row[col] ?? ''
      const str = String(val)
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str
    }).join(',')
  ).join('\n')
  return header + '\n' + body
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function CampaignExports({
  campaignId,
  campaignName,
}: {
  campaignId: number
  campaignName: string
}) {
  const [loading, setLoading] = useState<string | null>(null)
  const supabase = createClient()
  const slug = campaignName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

  async function exportEmails() {
    setLoading('emails')
    try {
      const { data, error } = await supabase.rpc('get_campaign_emails', { p_campaign_id: campaignId })
      if (error) throw error
      const csv = toCSV(data as Record<string, unknown>[], ['email'])
      downloadCSV(csv, `${slug}-emails.csv`)
    } finally {
      setLoading(null)
    }
  }

  async function exportOrders() {
    setLoading('orders')
    try {
      const { data, error } = await supabase.rpc('get_campaign_orders_export', { p_campaign_id: campaignId })
      if (error) throw error
      const cols = ['email', 'full_name', 'product_name', 'variant_name', 'quantity', 'price_paid', 'order_id', 'ordered_at']
      downloadCSV(toCSV(data as Record<string, unknown>[], cols), `${slug}-orders.csv`)
    } finally {
      setLoading(null)
    }
  }

  async function exportCreditNames() {
    setLoading('credits')
    try {
      const { data, error } = await supabase.rpc('get_campaign_credit_names', { p_campaign_id: campaignId })
      if (error) throw error
      downloadCSV(toCSV(data as Record<string, unknown>[], ['email', 'credit_name']), `${slug}-credit-names.csv`)
    } finally {
      setLoading(null)
    }
  }

  const btn = 'flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <div className="flex flex-wrap gap-3">
      <button onClick={exportEmails} disabled={loading !== null} className={btn}>
        <span>↓</span>
        {loading === 'emails' ? 'Exporting…' : 'Unique Emails'}
      </button>
      <button onClick={exportOrders} disabled={loading !== null} className={btn}>
        <span>↓</span>
        {loading === 'orders' ? 'Exporting…' : 'All Orders'}
      </button>
      <button onClick={exportCreditNames} disabled={loading !== null} className={btn}>
        <span>↓</span>
        {loading === 'credits' ? 'Exporting…' : 'Credit Names'}
      </button>
    </div>
  )
}
