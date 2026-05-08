import type { Template } from './types.ts'

// Helper: resolve a campaign by id OR fuzzy name into a single id.
// Used as a CTE prefix in templates that take either input.
const RESOLVE_CAMPAIGN = `
  WITH target_campaign AS (
    SELECT id FROM aa_01_campaigns.campaigns
    WHERE id = $1::int OR ($2::text IS NOT NULL AND "Name" ILIKE '%' || $2::text || '%')
    ORDER BY id ASC
    LIMIT 1
  )
`

const CAMPAIGN_PARAMS = [
  { name: 'campaign_id', type: 'int', required: false } as const,
  { name: 'campaign_name', type: 'string', required: false } as const,
]

const buildCampaignParams = (p: Record<string, unknown>) => [
  p.campaign_id ?? null,
  p.campaign_name ?? null,
]

// 1. Paid backers for a campaign — deduped by lower(email).
const paidBackersForCampaign: Template = {
  name: 'paid_backers_for_campaign',
  description: 'All paid backers for a campaign, one row per unique email with totals.',
  example_questions: [
    'Give me all paid Aliens Expanded backers',
    'Show paid backers for The Thing Expanded',
    'List paid customers for campaign 4',
  ],
  params: CAMPAIGN_PARAMS,
  sql: () => `${RESOLVE_CAMPAIGN}
    SELECT
      LOWER(email) AS email,
      MAX(payload->'shipping_address'->>'first_name') AS first_name,
      MAX(payload->'shipping_address'->>'last_name')  AS last_name,
      MAX(payload->'shipping_address'->>'country_code') AS country_code,
      COUNT(*)        AS order_count,
      SUM(NULLIF(payload->>'total_price','')::numeric) AS total_spent,
      MAX(processed_at) AS last_order_at
    FROM aa_01_campaigns.raw_orders
    WHERE campaign_id = (SELECT id FROM target_campaign)
      AND financial_status = 'paid'
      AND email IS NOT NULL
    GROUP BY LOWER(email)
    ORDER BY total_spent DESC NULLS LAST
    LIMIT 50000;`,
  build_params: buildCampaignParams,
}

// 2. Multi-unit buyers — backers who bought >= min_units units in raw_orders line_items.
const multiUnitBuyersForCampaign: Template = {
  name: 'multi_unit_buyers_for_campaign',
  description: 'Backers in a campaign who purchased multiple units (sum of line_items quantity ≥ threshold).',
  example_questions: [
    'How many backers bought more than one Thing Expanded?',
    'Multi-unit buyers for Aliens Expanded',
    'Show backers with more than 2 units in campaign 1',
  ],
  params: [
    ...CAMPAIGN_PARAMS,
    { name: 'min_units', type: 'int', required: false, default: 2 },
  ],
  sql: () => `${RESOLVE_CAMPAIGN}
    , unit_counts AS (
      SELECT
        LOWER(ro.email) AS email,
        SUM((li->>'quantity')::int) AS units
      FROM aa_01_campaigns.raw_orders ro
      CROSS JOIN LATERAL jsonb_array_elements(ro.payload->'line_items') li
      WHERE ro.campaign_id = (SELECT id FROM target_campaign)
        AND ro.financial_status = 'paid'
        AND ro.email IS NOT NULL
      GROUP BY LOWER(ro.email)
    )
    SELECT email, units
    FROM unit_counts
    WHERE units >= COALESCE($3::int, 2)
    ORDER BY units DESC
    LIMIT 50000;`,
  build_params: (p) => [
    p.campaign_id ?? null,
    p.campaign_name ?? null,
    p.min_units ?? 2,
  ],
}

// 3. Refunded orders for a campaign.
const refundedOrdersForCampaign: Template = {
  name: 'refunded_orders_for_campaign',
  description: 'Shopify orders flagged as refunded for a given campaign.',
  example_questions: [
    'Refunded orders for Aliens Expanded',
    'Show me refunds in campaign 4',
    'List The Thing Expanded refunds',
  ],
  params: CAMPAIGN_PARAMS,
  sql: () => `${RESOLVE_CAMPAIGN}
    SELECT
      shopify_order_number,
      email,
      payload->>'total_price' AS total_price,
      payload->>'currency'    AS currency,
      processed_at
    FROM aa_01_campaigns.raw_orders
    WHERE campaign_id = (SELECT id FROM target_campaign)
      AND financial_status = 'refunded'
    ORDER BY processed_at DESC
    LIMIT 50000;`,
  build_params: buildCampaignParams,
}

// 4. ISOD-only customers — has_isod_orders but no customer_raw_orders rows.
const isodOnlyCustomers: Template = {
  name: 'isod_only_customers',
  description: 'Customers who only have ISOD legacy orders (no Shopify raw orders).',
  example_questions: [
    'Customers who only bought ISOD',
    'ISOD-only backers',
    'Show me people on the ISOD legacy import who never ordered on Shopify',
  ],
  params: [],
  sql: () => `
    SELECT c.email, c.first_name, c.last_name, c.shipping_country, c.total_spend, c.total_orders
    FROM aa_02_crm.customers c
    WHERE c.has_isod_orders = true
      AND NOT EXISTS (
        SELECT 1 FROM aa_02_crm.customer_raw_orders cro WHERE cro.customer_id = c.id
      )
    ORDER BY c.total_spend DESC NULLS LAST
    LIMIT 50000;`,
  build_params: () => [],
}

// 5. Customers who appear in BOTH ISOD and Shopify (the overlap cohort).
const customersWithIsodAndShopify: Template = {
  name: 'customers_with_isod_and_shopify',
  description: 'Customers who appear in both the ISOD legacy import and Shopify raw orders.',
  example_questions: [
    'Customers in both ISOD and Shopify',
    'The 1795 overlap cohort',
    'Backers who bought on both ISOD and Shopify',
  ],
  params: [],
  sql: () => `
    SELECT c.email, c.first_name, c.last_name, c.shipping_country, c.total_spend, c.total_orders
    FROM aa_02_crm.customers c
    WHERE c.has_isod_orders = true
      AND c.has_raw_orders  = true
    ORDER BY c.total_spend DESC NULLS LAST
    LIMIT 50000;`,
  build_params: () => [],
}

// 6. Order counts grouped by campaign across raw + isod orders.
const campaignOrderCounts: Template = {
  name: 'campaign_order_counts',
  description: 'Per-campaign order counts (raw Shopify + ISOD legacy combined).',
  example_questions: [
    'Order counts by campaign',
    'How many orders per campaign?',
    'Campaign totals',
  ],
  params: [],
  sql: () => `
    WITH counts AS (
      SELECT campaign_id, COUNT(*) AS shopify_orders, 0 AS isod_orders
      FROM aa_01_campaigns.raw_orders
      GROUP BY campaign_id
      UNION ALL
      SELECT campaign_id, 0, COUNT(*)
      FROM aa_01_campaigns.isod_orders
      GROUP BY campaign_id
    )
    SELECT
      c.id AS campaign_id,
      c."Name" AS campaign_name,
      c.legacy_code,
      COALESCE(SUM(counts.shopify_orders), 0) AS shopify_orders,
      COALESCE(SUM(counts.isod_orders),    0) AS isod_orders,
      COALESCE(SUM(counts.shopify_orders), 0) + COALESCE(SUM(counts.isod_orders), 0) AS total_orders
    FROM aa_01_campaigns.campaigns c
    LEFT JOIN counts ON counts.campaign_id = c.id
    GROUP BY c.id, c."Name", c.legacy_code
    ORDER BY total_orders DESC;`,
  build_params: () => [],
}

// 7. Orders by Shopify order number suffix — routing/debug helper.
const ordersBySuffix: Template = {
  name: 'orders_by_suffix',
  description: 'Find Shopify orders whose order number ends with a given suffix (routing/debug).',
  example_questions: [
    'Find orders ending in -ABC',
    'Orders with suffix XYZ',
    'Show orders whose number ends in 123',
  ],
  params: [
    { name: 'suffix', type: 'string', required: true },
  ],
  sql: () => `
    SELECT
      ro.shopify_order_number,
      ro.email,
      ro.financial_status,
      ro.shop_domain,
      c."Name" AS campaign_name,
      ro.processed_at
    FROM aa_01_campaigns.raw_orders ro
    LEFT JOIN aa_01_campaigns.campaigns c ON c.id = ro.campaign_id
    WHERE ro.shopify_order_number ILIKE '%' || $1::text
    ORDER BY ro.processed_at DESC
    LIMIT 50000;`,
  build_params: (p) => [p.suffix ?? ''],
}

// 8. Backers in a campaign filtered by shipping country code (from payload).
const backersByCountry: Template = {
  name: 'backers_by_country',
  description: 'Paid backers in a campaign filtered by shipping country code (e.g. GB, US).',
  example_questions: [
    'Aliens Expanded backers in the UK',
    'Show ISOD backers in Germany',
    'Campaign 1 paid backers in country GB',
  ],
  params: [
    ...CAMPAIGN_PARAMS,
    { name: 'country_code', type: 'string', required: true, validation: /^[A-Za-z]{2}$/ },
  ],
  sql: () => `${RESOLVE_CAMPAIGN}
    SELECT
      LOWER(email) AS email,
      MAX(payload->'shipping_address'->>'first_name') AS first_name,
      MAX(payload->'shipping_address'->>'last_name')  AS last_name,
      MAX(payload->'shipping_address'->>'country_code') AS country_code,
      MAX(payload->'shipping_address'->>'city')        AS city,
      COUNT(*) AS order_count,
      SUM(NULLIF(payload->>'total_price','')::numeric) AS total_spent
    FROM aa_01_campaigns.raw_orders
    WHERE campaign_id = (SELECT id FROM target_campaign)
      AND financial_status = 'paid'
      AND UPPER(payload->'shipping_address'->>'country_code') = UPPER($3::text)
      AND email IS NOT NULL
    GROUP BY LOWER(email)
    ORDER BY total_spent DESC NULLS LAST
    LIMIT 50000;`,
  build_params: (p) => [
    p.campaign_id ?? null,
    p.campaign_name ?? null,
    p.country_code ?? '',
  ],
}

// 9. Recent orders within the last N days for a campaign.
const recentOrders: Template = {
  name: 'recent_orders',
  description: 'Shopify orders for a campaign in the last N days (default 7).',
  example_questions: [
    'Recent orders for Aliens Expanded',
    'Last 30 days of orders for The Thing Expanded',
    'Orders in the last week for campaign 4',
  ],
  params: [
    ...CAMPAIGN_PARAMS,
    { name: 'days', type: 'int', required: false, default: 7 },
  ],
  sql: () => `${RESOLVE_CAMPAIGN}
    SELECT
      shopify_order_number,
      email,
      financial_status,
      payload->>'total_price' AS total_price,
      payload->>'currency'    AS currency,
      processed_at
    FROM aa_01_campaigns.raw_orders
    WHERE campaign_id = (SELECT id FROM target_campaign)
      AND processed_at >= now() - (COALESCE($3::int, 7) || ' days')::interval
    ORDER BY processed_at DESC
    LIMIT 50000;`,
  build_params: (p) => [
    p.campaign_id ?? null,
    p.campaign_name ?? null,
    p.days ?? 7,
  ],
}

// 10. Customer lookup by email — single record + all_campaigns from view.
const customerLookupByEmail: Template = {
  name: 'customer_lookup_by_email',
  description: 'Look up a single customer by email and return their campaigns and totals.',
  example_questions: [
    'Find customer by email foo@example.com',
    'Look up jane@x.com',
    'Show me details for the customer at example@gmail.com',
  ],
  params: [
    { name: 'email', type: 'string', required: true },
  ],
  sql: () => `
    SELECT
      id, email, first_name, last_name, shipping_country,
      total_orders, total_quantity_purchased, total_spend,
      has_raw_orders, has_isod_orders, has_campaign_orders,
      all_campaigns
    FROM aa_02_crm.customer_summary
    WHERE LOWER(email) = LOWER($1::text)
    LIMIT 1;`,
  build_params: (p) => [String(p.email ?? '').trim()],
}

export const templates: Template[] = [
  paidBackersForCampaign,
  multiUnitBuyersForCampaign,
  refundedOrdersForCampaign,
  isodOnlyCustomers,
  customersWithIsodAndShopify,
  campaignOrderCounts,
  ordersBySuffix,
  backersByCountry,
  recentOrders,
  customerLookupByEmail,
]

export const templateByName: Record<string, Template> = Object.fromEntries(
  templates.map((t) => [t.name, t])
)
