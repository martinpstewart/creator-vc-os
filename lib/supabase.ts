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
// Cached: 60s — aggregated stats over Backerkit/Shopify/ISOD don't churn fast.
export const getCampaignStats = unstable_cache(
  () =>
    withRetry(async () => {
      const { data, error } = await supabase.rpc('get_campaign_stats')
      if (error) throw error
      return (data ?? []) as { campaign_id: number; campaign_name: string; total_customers: number; total_spend: number; total_orders: number }[]
    }, 'getCampaignStats'),
  ['campaign-stats'],
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

// Backer list for campaign detail page — paginated inside SQL to stay under PostgREST max-rows
export async function getCampaignBackerList(campaignId: number, page = 1, pageSize = 100) {
  return withRetry(async () => {
    const { data, error } = await supabase.rpc('get_campaign_backer_list', {
      p_campaign_id: campaignId,
      p_page: page,
      p_page_size: pageSize,
    })
    if (error) throw error
    const rows = (data ?? []) as BackerRow[]
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0
    return { backers: rows, total }
  }, 'getCampaignBackerList')
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
// Cached: 60s, keyed per-campaign — products in a campaign change slowly.
export const getCampaignUnitsSold = unstable_cache(
  (campaignId: number) =>
    withRetry(async () => {
      const { data, error } = await supabase.rpc('get_campaign_units_sold', { p_campaign_id: campaignId })
      if (error) throw error
      return (data ?? []) as { product_name: string; variant_name: string | null; total_quantity: number }[]
    }, 'getCampaignUnitsSold'),
  ['campaign-units-sold'],
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
