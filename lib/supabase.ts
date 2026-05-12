import { createClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'

// Server-side data client. Stateless on purpose: no auth persistence or
// background token refresh — those mutate shared state on warm Vercel
// functions and cause "page failed to load" after idle periods.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  }
)

const campaignSchema = supabase.schema('aa_01_campaigns')
const crm = supabase.schema('aa_02_crm')

// Run an RPC/query with one quick retry on transient failure.
// Many Vercel→Supabase blips (TLS handshake, fetch ECONNRESET, brief
// PostgREST 5xx) are gone within a few hundred ms.
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    console.warn(`[supabase] ${label} failed, retrying once:`, e)
    await new Promise((r) => setTimeout(r, 250))
    return await fn()
  }
}

// Dashboard KPIs — count unique customers from customer_summary.
// Cached: 60s — value rarely changes minute-to-minute.
export const getKPIs = unstable_cache(
  () =>
    withRetry(async () => {
      const { count, error } = await crm
        .from('customer_summary')
        .select('*', { count: 'exact', head: true })
      if (error) throw error
      return { total_customers: count ?? 0 }
    }, 'getKPIs'),
  ['kpis'],
  { revalidate: 60, tags: ['kpis'] }
)

// All campaigns for filter dropdown.
// Cached: 5 min — campaign list is very stable.
export const getCampaigns = unstable_cache(
  () =>
    withRetry(async () => {
      const { data, error } = await supabase.rpc('get_campaigns')
      if (error) throw error
      return (data ?? []) as { id: number; name: string; legacy_code: string }[]
    }, 'getCampaigns'),
  ['campaigns'],
  { revalidate: 300, tags: ['campaigns'] }
)

// Per-campaign stats for dashboard.
//
// Backed by aa_01_campaigns.v_raw_order_line_attribution per Martin's
// 12-May patch — the view resolves variant_id → SKU → fuzzy and exposes
// product_campaign_id (correct attribution) separately from
// order_campaign_id (the routing value). Fixes Thing Expanded numbers
// that were undercounting units by ~50% under the old raw_orders path.
//
// Strategy: keep the existing get_campaign_stats RPC for structure +
// ISOD-correct numbers (it's SECURITY DEFINER so it bypasses the
// campaigns / isod_orders RLS that locks out anon), then OVERRIDE the
// totals for any campaign where the attribution view has data. ISOD-only
// campaigns fall through to the RPC's numbers unchanged.
//
// Cached: 60s.
type CampaignStatRow = {
  campaign_id: number
  campaign_name: string
  total_customers: number
  total_spend: number
  total_orders: number
}

export const getCampaignStats = unstable_cache(
  () =>
    withRetry(async () => {
      const [rpcRes, viewRes] = await Promise.all([
        supabase.rpc('get_campaign_stats'),
        supabase
          .schema('aa_01_campaigns')
          .from('v_raw_order_line_attribution')
          .select('shopify_order_id, email, line_revenue, product_campaign_id')
          .eq('financial_status', 'paid')
          .range(0, 99999),
      ])
      if (rpcRes.error) throw rpcRes.error
      if (viewRes.error) throw viewRes.error

      type Agg = { orders: Set<string>; backers: Set<string>; revenue: number }
      const viewAgg = new Map<number, Agg>()
      for (const row of viewRes.data ?? []) {
        const id = row.product_campaign_id as number | null
        if (id == null) continue
        const m = viewAgg.get(id) ?? { orders: new Set(), backers: new Set(), revenue: 0 }
        if (row.shopify_order_id) m.orders.add(row.shopify_order_id as string)
        if (row.email) m.backers.add(String(row.email))
        m.revenue += Number(row.line_revenue ?? 0)
        viewAgg.set(id, m)
      }

      // Override RPC numbers for campaigns the view covers (raw_orders).
      // ISOD-only campaigns keep the RPC's already-correct ISOD aggregates.
      return ((rpcRes.data ?? []) as CampaignStatRow[]).map((s) => {
        const v = viewAgg.get(s.campaign_id)
        if (!v || v.orders.size === 0) return s
        return {
          campaign_id: s.campaign_id,
          campaign_name: s.campaign_name,
          total_customers: v.backers.size,
          total_spend: v.revenue,
          total_orders: v.orders.size,
        }
      })
    }, 'getCampaignStats'),
  ['campaign-stats-v3'],
  { revalidate: 60, tags: ['campaign-stats'] }
)

type CustomerRow = {
  id: number
  email: string
  full_name: string | null
  total_orders: number
  total_spend: string | number
  shipping_city: string | null
  shipping_country: string | null
  is_backer: boolean
  campaign_orders_detail: unknown
  raw_orders_detail: unknown
  isod_orders_detail: unknown
  total_count: number
}

// Customers list — uses RPC so spend is based on actual Shopify raw_orders (not Backerkit summary)
export async function getCustomers(search?: string, page = 1, pageSize = 50, campaignIds?: number[]) {
  return withRetry(async () => {
    const { data, error } = await supabase.rpc('get_customers_list', {
      p_search: search ?? null,
      p_page: page,
      p_page_size: pageSize,
      p_campaign_ids: campaignIds && campaignIds.length > 0 ? campaignIds : null,
    })
    if (error) throw error
    const rows = (data ?? []) as CustomerRow[]
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0
    return { customers: rows, total }
  }, 'getCustomers')
}

// Per-customer per-campaign order line items (for customer detail click-through)
export async function getCustomerCampaignOrders(email: string, campaignId: number) {
  return withRetry(async () => {
    const { data, error } = await supabase.rpc('get_customer_campaign_orders', {
      p_email: email,
      p_campaign_id: campaignId,
    })
    if (error) throw error
    return (data ?? []) as {
      product_name: string
      variant_name: string | null
      quantity: number
      price_paid: number | null
      order_id: string
      purchase_type: string
    }[]
  }, 'getCustomerCampaignOrders')
}

export type BackerRow = { email: string; full_name: string | null; total_spend: number | null; order_count: number; total_count: number }

// Backer list. Primary path uses the attribution view filtered by
// product_campaign_id so a backer is "someone who bought a product
// attributed to campaign X", not "someone whose order routed to X".
// Pagination is client-side over a per-campaign cached full list.
//
// ISOD-only campaigns fall through to the existing SECURITY DEFINER
// RPC (anon can't read isod_orders directly under RLS).
const _getCampaignBackerListFull = unstable_cache(
  (campaignId: number) =>
    withRetry(async () => {
      const { data: viewRows, error } = await supabase
        .schema('aa_01_campaigns')
        .from('v_raw_order_line_attribution')
        .select('email, shopify_order_id, line_revenue')
        .eq('product_campaign_id', campaignId)
        .eq('financial_status', 'paid')
        .not('product_id', 'is', null)
        .not('email', 'is', null)
        .range(0, 99999)
      if (error) throw error

      type Row = { email: string; orders: Set<string>; spend: number }
      const byEmail = new Map<string, Row>()
      for (const r of viewRows ?? []) {
        const key = String(r.email)
        const m = byEmail.get(key) ?? { email: r.email as string, orders: new Set(), spend: 0 }
        m.orders.add(r.shopify_order_id as string)
        m.spend += Number(r.line_revenue ?? 0)
        byEmail.set(key, m)
      }

      // ISOD-only campaign — pull the whole list via the RPC, return as-is.
      if (byEmail.size === 0) {
        // The RPC paginates; ask for a generous page size in one shot.
        const { data: rpcRows, error: rpcErr } = await supabase.rpc(
          'get_campaign_backer_list',
          { p_campaign_id: campaignId, p_page: 1, p_page_size: 100000 },
        )
        if (rpcErr) throw rpcErr
        const rows = (rpcRows ?? []) as BackerRow[]
        return rows.map((b) => ({
          email: b.email,
          full_name: b.full_name,
          order_count: b.order_count,
          total_spend: b.total_spend,
        }))
      }

      return Array.from(byEmail.values())
        .map((b) => ({
          email: b.email,
          full_name: null as string | null,
          order_count: b.orders.size,
          total_spend: b.spend,
        }))
        .sort((a, b) => (b.total_spend ?? 0) - (a.total_spend ?? 0))
    }, 'getCampaignBackerListFull'),
  ['campaign-backers-v3'],
  { revalidate: 60, tags: ['campaign-backers'] }
)

export async function getCampaignBackerList(campaignId: number, page = 1, pageSize = 100) {
  const all = await _getCampaignBackerListFull(campaignId)
  const start = Math.max(0, (page - 1) * pageSize)
  const slice = all.slice(start, start + pageSize)
  return {
    backers: slice.map((b) => ({ ...b, total_count: all.length })) as BackerRow[],
    total: all.length,
  }
}

// All order line items for a campaign (CSV export)
export async function getCampaignOrdersExport(campaignId: number) {
  return withRetry(async () => {
    const { data, error } = await supabase.rpc('get_campaign_orders_export', { p_campaign_id: campaignId })
    if (error) throw error
    return (data ?? []) as {
      email: string; full_name: string | null; product_name: string
      variant_name: string | null; quantity: number; price_paid: number | null
      order_id: string; ordered_at: string
    }[]
  }, 'getCampaignOrdersExport')
}

// Unique emails for a campaign (CSV export)
export async function getCampaignEmails(campaignId: number) {
  return withRetry(async () => {
    const { data, error } = await supabase.rpc('get_campaign_emails', { p_campaign_id: campaignId })
    if (error) throw error
    return (data ?? []) as { email: string }[]
  }, 'getCampaignEmails')
}

// Credit names from Shopify order properties (CSV export)
export async function getCampaignCreditNames(campaignId: number) {
  return withRetry(async () => {
    const { data, error } = await supabase.rpc('get_campaign_credit_names', { p_campaign_id: campaignId })
    if (error) throw error
    return (data ?? []) as { email: string; credit_name: string }[]
  }, 'getCampaignCreditNames')
}

// Units sold per product/variant for a campaign.
//
// Primary: canonical attribution view, grouped client-side. ISOD-only
// campaigns (where the view returns no rows) fall through to the
// existing SECURITY DEFINER RPC because anon can't read isod_order_lines
// directly under RLS.
// Cached: 60s, keyed per-campaign.
type UnitsSoldRow = { product_name: string; variant_name: string | null; total_quantity: number }

export const getCampaignUnitsSold = unstable_cache(
  (campaignId: number) =>
    withRetry(async () => {
      const { data: viewRows, error } = await supabase
        .schema('aa_01_campaigns')
        .from('v_raw_order_line_attribution')
        .select('product_name, variant_name, quantity')
        .eq('product_campaign_id', campaignId)
        .eq('financial_status', 'paid')
        .not('product_id', 'is', null)
        .range(0, 99999)
      if (error) throw error

      const grouped = new Map<string, UnitsSoldRow>()
      for (const r of viewRows ?? []) {
        const key = `${r.product_name ?? ''}||${r.variant_name ?? ''}`
        const m = grouped.get(key) ?? {
          product_name: r.product_name as string,
          variant_name: (r.variant_name as string | null) ?? null,
          total_quantity: 0,
        }
        m.total_quantity += Number(r.quantity ?? 0)
        grouped.set(key, m)
      }

      // ISOD-only campaign fallback (e.g. campaign 2). The existing RPC
      // is SECURITY DEFINER and aggregates from isod_order_lines.
      if (grouped.size === 0) {
        const { data: rpcRows, error: rpcErr } = await supabase
          .rpc('get_campaign_units_sold', { p_campaign_id: campaignId })
        if (rpcErr) throw rpcErr
        return (rpcRows ?? []) as UnitsSoldRow[]
      }

      return Array.from(grouped.values()).sort((a, b) => b.total_quantity - a.total_quantity)
    }, 'getCampaignUnitsSold'),
  ['campaign-units-sold-v3'],
  { revalidate: 60, tags: ['campaign-units-sold'] }
)

// Single customer detail — uses RPC so total_spend reflects actual Shopify line items, not Backerkit
export async function getCustomerByEmail(email: string) {
  return withRetry(async () => {
    const { data, error } = await supabase.rpc('get_customer_detail', { p_email: email })
    if (error) throw error
    if (!data || data.length === 0) return null
    return data[0] as {
    id: number
    email: string
    full_name: string | null
    phone: string | null
    total_orders: number
    total_spend: number
    total_line_items: number
    total_quantity_purchased: number
    has_campaign_orders: boolean
    has_raw_orders: boolean
    has_isod_orders: boolean
    shipping_address_1: string | null
    shipping_address_2: string | null
    shipping_city: string | null
    shipping_zip: string | null
    shipping_country: string | null
    campaign_orders_detail: unknown
    raw_orders_detail: unknown
    isod_orders_detail: unknown
    }
  }, 'getCustomerByEmail')
}
