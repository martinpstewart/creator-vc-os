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
// 12-May patch — the view resolves variant_id → SKU → fuzzy so that
// fragmented Shopify line-item titles collapse onto canonical products,
// and exposes product_campaign_id (correct) separately from
// order_campaign_id (the routing value). Filtering on product_campaign_id
// fixes the Thing Expanded numbers (was undercounting units by ~50%).
//
// ISOD-only campaigns aren't in raw_orders, so we union the view with
// an aggregate over isod_orders + isod_order_lines.
//
// Cached: 60s. ~25k raw rows pulled per refresh, aggregated client-side.
export const getCampaignStats = unstable_cache(
  () =>
    withRetry(async () => {
      const [viewRes, isodOrdersRes, campaignsRes] = await Promise.all([
        supabase
          .schema('aa_01_campaigns')
          .from('v_raw_order_line_attribution')
          .select('shopify_order_id, email, line_revenue, product_campaign_id, product_id')
          .eq('financial_status', 'paid')
          .not('product_id', 'is', null)
          .range(0, 99999),
        supabase
          .schema('aa_01_campaigns')
          .from('isod_orders')
          .select('id, campaign_id, customer_email, isod_order_lines(price_paid)')
          .range(0, 99999),
        supabase
          .schema('aa_01_campaigns')
          .from('campaigns')
          .select('id, "Name", legacy_code')
          .order('id'),
      ])
      if (viewRes.error) throw viewRes.error
      if (isodOrdersRes.error) throw isodOrdersRes.error
      if (campaignsRes.error) throw campaignsRes.error

      type Agg = { orders: Set<string | number>; backers: Set<string>; revenue: number }
      const make = (): Agg => ({ orders: new Set(), backers: new Set(), revenue: 0 })
      const byCampaign = new Map<number, Agg>()

      // Shopify line items via the canonical attribution view. Case-sensitive
      // email dedup to match the patch's smoke-test numbers.
      for (const row of viewRes.data ?? []) {
        const id = row.product_campaign_id as number | null
        if (id == null) continue
        const m = byCampaign.get(id) ?? make()
        if (row.shopify_order_id) m.orders.add(row.shopify_order_id as string)
        if (row.email) m.backers.add(String(row.email))
        m.revenue += Number(row.line_revenue ?? 0)
        byCampaign.set(id, m)
      }

      // ISOD legacy orders (campaign 2, etc.) — view doesn't cover these.
      for (const row of (isodOrdersRes.data ?? []) as Array<{
        id: number
        campaign_id: number
        customer_email: string | null
        isod_order_lines: { price_paid: number | string | null }[] | null
      }>) {
        const id = row.campaign_id
        if (id == null) continue
        const m = byCampaign.get(id) ?? make()
        m.orders.add(row.id)
        if (row.customer_email) m.backers.add(row.customer_email)
        for (const line of row.isod_order_lines ?? []) {
          m.revenue += Number(line.price_paid ?? 0)
        }
        byCampaign.set(id, m)
      }

      return (campaignsRes.data ?? []).map((c) => {
        const agg = byCampaign.get(c.id as number) ?? make()
        return {
          campaign_id: c.id as number,
          campaign_name: (c as Record<string, unknown>).Name as string,
          total_customers: agg.backers.size,
          total_spend: agg.revenue,
          total_orders: agg.orders.size,
        }
      })
    }, 'getCampaignStats'),
  ['campaign-stats-v2'],
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

// Cache the full deduped backer list per campaign once, then paginate
// client-side. Per-campaign caching keeps memory bounded and is much
// cheaper than paying the view roundtrip per page.
//
// Uses product_campaign_id from v_raw_order_line_attribution so a backer
// is "someone who bought a product attributed to campaign X", not
// "someone whose order routed to X". ISOD-only campaigns fall back to
// isod_orders.
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

      // Case-sensitive email key to match the headline KPI count.
      type Row = { email: string; orders: Set<string>; spend: number }
      const byEmail = new Map<string, Row>()
      for (const r of viewRows ?? []) {
        const key = String(r.email)
        const m = byEmail.get(key) ?? { email: r.email as string, orders: new Set(), spend: 0 }
        m.orders.add(r.shopify_order_id as string)
        m.spend += Number(r.line_revenue ?? 0)
        byEmail.set(key, m)
      }

      // ISOD-only campaign fallback.
      if (byEmail.size === 0) {
        const { data: isodRows, error: isodErr } = await supabase
          .schema('aa_01_campaigns')
          .from('isod_orders')
          .select('id, customer_email, isod_order_lines(price_paid)')
          .eq('campaign_id', campaignId)
          .not('customer_email', 'is', null)
          .range(0, 99999)
        if (isodErr) throw isodErr
        for (const r of (isodRows ?? []) as Array<{
          id: number
          customer_email: string
          isod_order_lines: { price_paid: number | string | null }[] | null
        }>) {
          const key = r.customer_email
          const m = byEmail.get(key) ?? { email: r.customer_email, orders: new Set(), spend: 0 }
          m.orders.add(String(r.id))
          for (const line of r.isod_order_lines ?? []) {
            m.spend += Number(line.price_paid ?? 0)
          }
          byEmail.set(key, m)
        }
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
  ['campaign-backers-v2'],
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
// Uses the canonical attribution view, grouped client-side. ISOD-only
// campaigns fall back to isod_order_lines via the FK relationship.
// Cached: 60s, keyed per-campaign.
export const getCampaignUnitsSold = unstable_cache(
  (campaignId: number) =>
    withRetry(async () => {
      // Primary: Shopify line items via the attribution view.
      const { data: viewRows, error } = await supabase
        .schema('aa_01_campaigns')
        .from('v_raw_order_line_attribution')
        .select('product_name, variant_name, quantity')
        .eq('product_campaign_id', campaignId)
        .eq('financial_status', 'paid')
        .not('product_id', 'is', null)
        .range(0, 99999)
      if (error) throw error

      const grouped = new Map<string, { product_name: string; variant_name: string | null; total_quantity: number }>()
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

      // Fallback for ISOD-only campaigns (e.g. campaign 2): view is empty,
      // pivot to isod_order_lines via the isod_orders FK.
      if (grouped.size === 0) {
        const { data: isodLines, error: isodErr } = await supabase
          .schema('aa_01_campaigns')
          .from('isod_order_lines')
          .select('line_title, line_variant_title, line_quantity, isod_orders!inner(campaign_id)')
          .eq('isod_orders.campaign_id', campaignId)
          .range(0, 99999)
        if (isodErr) throw isodErr
        for (const r of (isodLines ?? []) as Array<{
          line_title: string | null
          line_variant_title: string | null
          line_quantity: string | null
        }>) {
          const key = `${r.line_title ?? ''}||${r.line_variant_title ?? ''}`
          const m = grouped.get(key) ?? {
            product_name: r.line_title ?? '',
            variant_name: r.line_variant_title,
            total_quantity: 0,
          }
          m.total_quantity += parseInt(r.line_quantity ?? '0', 10) || 0
          grouped.set(key, m)
        }
      }

      return Array.from(grouped.values()).sort((a, b) => b.total_quantity - a.total_quantity)
    }, 'getCampaignUnitsSold'),
  ['campaign-units-sold-v2'],
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
