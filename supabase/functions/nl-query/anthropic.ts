import type { MatchResult, TemplateMetadata } from './types.ts'
import { templates } from './templates.ts'

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
// Haiku for cheap/fast template matching; Sonnet for the heavier
// generation path where structured SQL with schema awareness matters.
const MATCHER_MODEL = 'claude-haiku-4-5-20251001'
const GENERATOR_MODEL = 'claude-sonnet-4-6'

const SCHEMA_CONTEXT = `
You write read-only PostgreSQL for the Creator VC OS data warehouse.

Schemas (always prefix; never use bare table names):
- aa_01_campaigns
  - campaigns (id, "Name" — note the column is double-quoted, capital N, legacy_code, shop_domain via shop_domains)
  - raw_orders (id, campaign_id, shopify_order_id, shopify_order_number, email, financial_status, payload jsonb {line_items, shipping_address {country_code, city, first_name, last_name}, billing_address, customer, total_price, currency}, processed_at, shop_domain)
  - isod_orders (id, campaign_id default 2, customer_email, shipping_country, shipping_country_code, order_created_at)
  - isod_order_lines (isod_order_id, line_title, line_sku, line_quantity text, price_paid)
  - campaign_orders, campaign_order_lines (unified order tables)
  - products, variants, shopify_variants_map
  - order_entitlements (campaign_id, email, product_legacy_code, quantity, price_paid)
- aa_02_crm
  - customers (id, email, first_name, last_name, has_raw_orders, has_isod_orders, has_campaign_orders, total_spend, total_orders, shipping_country, shipping_country_code)
  - customer_raw_orders, customer_isod_orders, customer_campaign_orders (junction tables)
  - customer_summary (view, joins everything; has all_campaigns jsonb)

Campaign registry (id → "Name", legacy_code):
  1 The Thing Expanded               TT_EXPANDED
  2 In Search of Darkness 1995       ISOD_95
  3 FPS: First Person Shooter        FPS_DOC
  4 Aliens Expanded 40th Anniversary ALIENS_EXPANDED

Notes for queries:
- "paid" means raw_orders.financial_status = 'paid'.
- "refunded" means raw_orders.financial_status = 'refunded'.
- "backers" usually means deduped paid customers — group by LOWER(email).
- raw_orders.payload is a JSONB Shopify order. line_items is an array; shipping_address is an object.
- Always end with LIMIT 50000 unless the user has asked for a smaller cap.
- Output ONLY the SQL — no markdown fences, no commentary, no explanations.
`.trim()

async function callAnthropic(args: {
  apiKey: string
  model: string
  system: string
  user: string
  maxTokens: number
}): Promise<string> {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': args.apiKey,
    },
    body: JSON.stringify({
      model: args.model,
      max_tokens: args.maxTokens,
      system: args.system,
      messages: [{ role: 'user', content: args.user }],
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 500)}`)
  }
  const data = await res.json() as { content: { type: string; text?: string }[] }
  const text = data.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
  if (!text) throw new Error('Anthropic returned no text content')
  return text.trim()
}

// Strip ```sql fences, leading/trailing prose. The generator has
// instructions to omit them, but Claude occasionally adds them back.
function stripCodeFences(s: string): string {
  let t = s.trim()
  t = t.replace(/^```(?:sql|postgresql)?\s*/i, '')
  t = t.replace(/\s*```\s*$/i, '')
  return t.trim()
}

export async function matchTemplate(args: {
  apiKey: string
  question: string
}): Promise<MatchResult> {
  const metadata: TemplateMetadata[] = templates.map((t) => ({
    name: t.name,
    description: t.description,
    example_questions: t.example_questions,
    params: t.params,
  }))

  const system = `You are a router. Given a user question, decide if any of the listed SQL templates can answer it. If yes, extract the parameters from the question. Return STRICT JSON only — no prose, no markdown.

JSON shape on match:
{"match": true, "template_name": "<name>", "params": { ... }, "confidence": "high"|"medium"|"low"}

JSON shape on no match:
{"match": false}

Confidence rubric:
- high: question maps directly to one template, params are explicit
- medium: template fits but a param had to be inferred from context
- low: template might fit but it's a stretch — prefer "match: false" instead

Templates available:
${JSON.stringify(metadata, null, 2)}`

  const text = await callAnthropic({
    apiKey: args.apiKey,
    model: MATCHER_MODEL,
    system,
    user: args.question,
    maxTokens: 400,
  })

  const cleaned = stripCodeFences(text)
  try {
    const parsed = JSON.parse(cleaned) as MatchResult
    if (parsed.match === true) {
      // Sanity-check the template name is real
      if (!templates.find((t) => t.name === parsed.template_name)) {
        return { match: false }
      }
    }
    return parsed
  } catch {
    return { match: false }
  }
}

export async function generateSql(args: {
  apiKey: string
  question: string
}): Promise<string> {
  const text = await callAnthropic({
    apiKey: args.apiKey,
    model: GENERATOR_MODEL,
    system: `${SCHEMA_CONTEXT}

Output the SQL only. No markdown fences. No commentary.`,
    user: args.question,
    maxTokens: 1500,
  })

  return stripCodeFences(text)
}
