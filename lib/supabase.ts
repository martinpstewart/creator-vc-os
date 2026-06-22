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
// Exported so the auth helpers + ticket wrappers can share one retry
// policy — anywhere else that talks to Supabase should call through this.
export async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    console.warn(`[supabase] ${label} failed, retrying once:`, e)
    await new Promise((r) => setTimeout(r, 250))
    return await fn()
  }
}

// Home dashboard payload — the big JSON the dashboard page renders.
// Backed by public.home_dashboard_impl which now reads from
// aa_02_crm.dashboard_snapshot (refreshed every 5 min by pg_cron).
// The RPC returns in ~2ms so we deliberately do NOT layer
// unstable_cache on top — the DB IS the cache. A Next.js cache here
// would just delay updates from the cron refresh.
export async function getHomeDashboardCached() {
  return withRetry(async () => {
    const { data, error } = await supabase.rpc('home_dashboard_impl')
    if (error) throw error
    return data as Record<string, unknown>
  }, 'getHomeDashboardCached')
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

// Canonical paying-customer count — single source of truth for any
// screen that needs "how many paying customers do we have, deduped".
// Backed by aa_02_crm.v_paying_customer_emails. Used by the Campaigns
// header so its total reconciles with the Customers page + home
// headline; otherwise summing per-campaign counts would over-count
// anyone who backed multiple campaigns.
export const getPayingCustomerCount = unstable_cache(
  () =>
    withRetry(async () => {
      const { data, error } = await supabase.rpc('get_paying_customer_count')
      if (error) throw error
      return Number(data ?? 0)
    }, 'getPayingCustomerCount'),
  ['paying-customer-count'],
  { revalidate: 60, tags: ['paying-customer-count'] }
)

// Per-campaign stats for dashboard.
//
// Calls public.get_campaign_stats_v2 — a SECURITY DEFINER RPC that
// aggregates v_raw_order_line_attribution server-side (raw Shopify
// numbers via the canonical attribution view) and falls through to
// the original get_campaign_stats for ISOD-only campaigns. Done in
// SQL because Supabase's db-max-rows=1000 silently truncated the
// client-side aggregation path.
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
      // v3 is the canonical paying-customer source — per-campaign
      // distinct-email counts come from the same gating logic as
      // get_campaign_backer_list_combined, so the campaigns list,
      // campaign detail tile, and Ask "paid_backers_for_campaign"
      // template all agree. v3 was rewritten in the hotfix migration
      // (20260603120000) to inline its logic instead of going through
      // the v_campaign_paying_emails view, which was too slow.
      const { data, error } = await supabase.rpc('get_campaign_stats_v3')
      if (error) throw error
      return (data ?? []) as CampaignStatRow[]
    }, 'getCampaignStats'),
  ['campaign-stats-v7'],
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
  historic_orders_detail: unknown
  total_count: number
}

// Customers list — backed by aa_02_crm.customer_list_snapshot
// (refreshed every 10 min by pg_cron). The snapshot RPC reads in
// ~180ms, but on Vercel Hobby a cold serverless cold-start + role
// lookup + this RPC + getCampaigns can still drift past the 10s
// function timeout. Layering unstable_cache on top doesn't compromise
// freshness — the DB snapshot already enforces a 10-min staleness
// contract — and turns repeat hits into sub-50ms responses.
const getCustomersCached = unstable_cache(
  async (
    search: string | null,
    page: number,
    pageSize: number,
    campaignIds: number[] | null,
    stores: string[] | null,
  ) =>
    withRetry(async () => {
      const { data, error } = await supabase.rpc('get_customers_list', {
        p_search: search,
        p_page: page,
        p_page_size: pageSize,
        p_campaign_ids: campaignIds,
        p_stores: stores,
      })
      if (error) throw error
      const rows = (data ?? []) as CustomerRow[]
      const total = rows.length > 0 ? Number(rows[0].total_count) : 0
      return { customers: rows, total }
    }, 'getCustomersCached'),
  ['customers-list-v3'],
  { revalidate: 600, tags: ['customers-list'] },
)

export async function getCustomers(
  search?: string,
  page = 1,
  pageSize = 50,
  campaignIds?: number[],
  stores?: string[],
) {
  return getCustomersCached(
    search ?? null,
    page,
    pageSize,
    campaignIds && campaignIds.length > 0 ? campaignIds : null,
    stores && stores.length > 0 ? stores : null,
  )
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
      // Human-readable identifier per source: shopify_order_number for
      // Shopify, purchase_order_number for ISOD, falls back to
      // shopify_order_id on the entitlement path (no friendlier value).
      order_number: string | null
      purchase_type: string
    }[]
  }, 'getCustomerCampaignOrders')
}

export type BackerRow = { email: string; full_name: string | null; total_spend: number | null; order_count: number; total_count: number }

// Backer list. Server-side paginated via the v2 RPC: attribution view
// filtered by product_campaign_id, ISOD fallback baked into the SQL.
export async function getCampaignBackerList(campaignId: number, page = 1, pageSize = 100) {
  return withRetry(async () => {
    // Combined RPC unions raw_orders / order_entitlements / isod_orders
    // / historic_orders so campaigns dominated by historic (TerrorBytes,
    // FPS cross-sells) show their actual backer list.
    const { data, error } = await supabase.rpc('get_campaign_backer_list_combined', {
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
// Server-side aggregation via the v2 RPC (attribution view +
// ISOD fallback). Cached: 60s, keyed per-campaign.
type UnitsSoldRow = { product_name: string; variant_name: string | null; total_quantity: number }

export const getCampaignUnitsSold = unstable_cache(
  (campaignId: number) =>
    withRetry(async () => {
      const { data, error } = await supabase.rpc('get_campaign_units_sold_v2', {
        p_campaign_id: campaignId,
      })
      if (error) throw error
      return (data ?? []) as UnitsSoldRow[]
    }, 'getCampaignUnitsSold'),
  ['campaign-units-sold-v4'],
  { revalidate: 60, tags: ['campaign-units-sold'] }
)

// Historic units-sold per product (from historic_orders CSV imports).
// Same shape as UnitsSoldRow but with an extra source_platform column
// so the UI can show which channel each historic product came from.
export type HistoricUnitsSoldRow = UnitsSoldRow & { source_platform: string }
export async function getCampaignHistoricUnitsSold(campaignId: number) {
  return withRetry(async () => {
    const { data, error } = await supabase.rpc('get_campaign_historic_units_sold', {
      p_campaign_id: campaignId,
    })
    if (error) throw error
    return (data ?? []) as HistoricUnitsSoldRow[]
  }, 'getCampaignHistoricUnitsSold')
}

// Unified per-campaign products list from every source we reconcile in
// the dashboard / campaigns list: live Shopify (v_raw_order_line_attribution)
// + historic CSV imports (historic_order_lines) + ISOD lines (identified by
// sku_after_correction). Includes per-product revenue so the Products tab
// ladders up to the campaign-level revenue figure.
export type CampaignProductRow = {
  product_name: string
  variant_name: string | null
  source_platform: string
  units: number
  revenue: number
}
export const getCampaignProducts = unstable_cache(
  (campaignId: number) =>
    withRetry(async () => {
      const { data, error } = await supabase.rpc('get_campaign_products_v2', {
        p_campaign_id: campaignId,
      })
      if (error) throw error
      return (data ?? []) as CampaignProductRow[]
    }, 'getCampaignProducts'),
  ['campaign-products-v2'],
  { revalidate: 60, tags: ['campaign-products'] }
)

// Historic-orders breakdown per platform for a campaign. Used by the
// campaign detail page to surface Gumroad / shopify_legacy / Wix activity
// that doesn't appear in v_raw_order_line_attribution.
export type HistoricBreakdownRow = {
  source_platform: string
  orders: number
  unique_customers: number
  revenue: number | string
  units: number
}
export async function getCampaignHistoricBreakdown(campaignId: number) {
  return withRetry(async () => {
    const { data, error } = await supabase.rpc('get_campaign_historic_breakdown', {
      p_campaign_id: campaignId,
    })
    if (error) throw error
    return (data ?? []) as HistoricBreakdownRow[]
  }, 'getCampaignHistoricBreakdown')
}

// One-shot rollup of historic_orders per campaign — for the campaigns
// list page so it can combine live + historic in a single render.
export type HistoricCampaignTotal = {
  campaign_id: number
  orders: number
  unique_customers: number
  revenue: number | string
  units: number
}
export async function getCampaignsHistoricTotals() {
  return withRetry(async () => {
    const { data, error } = await supabase.rpc('get_campaigns_historic_totals')
    if (error) throw error
    return (data ?? []) as HistoricCampaignTotal[]
  }, 'getCampaignsHistoricTotals')
}

// Single customer detail — uses RPC so total_spend reflects actual
// Shopify line items, not Backerkit. Cached: 600s, keyed by email.
// get_customer_detail runs ~1.1s warm but spikes during the live DB
// consolidation; caching prevents Vercel function timeouts on
// previously-viewed customers (e.g. the support team re-opening a
// ticket twice in a row).
type CustomerDetail = {
  id: number
  email: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  total_orders: number
  total_spend: number
  total_line_items: number
  total_quantity_purchased: number
  has_campaign_orders: boolean
  has_raw_orders: boolean
  has_isod_orders: boolean
  has_historic_orders: boolean
  shipping_address_1: string | null
  shipping_address_2: string | null
  shipping_city: string | null
  shipping_zip: string | null
  shipping_country: string | null
  shipping_country_code: string | null
  campaign_orders_detail: unknown
  raw_orders_detail: unknown
  isod_orders_detail: unknown
  historic_orders_detail: unknown
}

const getCustomerByEmailCached = unstable_cache(
  async (email: string): Promise<CustomerDetail | null> =>
    withRetry(async () => {
      const { data, error } = await supabase.rpc('get_customer_detail', { p_email: email })
      if (error) throw error
      if (!data || data.length === 0) return null
      return data[0] as CustomerDetail
    }, 'getCustomerByEmailCached'),
  ['customer-detail-v2'],
  { revalidate: 600, tags: ['customer-detail'] },
)

export async function getCustomerByEmail(email: string) {
  return getCustomerByEmailCached(email)
}
