import type { MatchResult, TemplateMetadata } from './types.ts'
import { templates } from './templates.ts'

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
// Haiku for cheap/fast template matching; Sonnet for the heavier
// generation path where structured SQL with schema awareness matters.
const MATCHER_MODEL = 'claude-haiku-4-5-20251001'
const GENERATOR_MODEL = 'claude-sonnet-4-6'

// Schema context for the SQL-generation path (no template matched).
// Rewritten 11 Jun 2026 to point at the unified read-only view
// aa_01_campaigns.v_all_orders — one row per order across every
// source (live Shopify, Gumroad, Wix, shopify_legacy, ISOD/CrowdOx).
// The view replaces the prior per-table schema dump so cross-source
// questions ("total paid revenue across everything") just work.
//
// The templates in templates.ts still query the underlying tables
// directly; this context only governs the freeform fallback in
// generateSql() below.
const SCHEMA_CONTEXT = `
You answer questions about Creator VC orders by writing a single read-only PostgreSQL SELECT against ONE view: aa_01_campaigns.v_all_orders. Never write to the database. Never query other tables unless explicitly told to. Return one SELECT statement.

View: aa_01_campaigns.v_all_orders — one row per order, all sources, all statuses.

| Column | Type | Meaning |
|---|---|---|
| order_key | text | Globally unique id, source:nativeid. Use for "this specific order". |
| source | text | Order origin: shopify (live), gumroad, wix, shopify_legacy (TerrorBytes-era), isod (CrowdOx). |
| order_number | text | Human order number / reference. |
| order_date | timestamptz | When the order was placed. Use for date ranges, "last month", trends. |
| email | text | Customer email, lowercased. |
| customer_name | text | Best-known name; may be NULL. |
| status | text | paid, refunded, partially_refunded, disputed, test. ISOD rows are always paid. |
| amount | numeric | Order total in original currency. May be NULL for a few line-less ISOD orders. |
| currency | text | Always USD today. |
| amount_usd | numeric | USD total (== amount today). Use this for all revenue/spend sums. |
| primary_campaign_id | bigint | The order's main/routing campaign. Use for "orders for campaign X". |
| primary_campaign_name | text | Readable name of the primary campaign. |
| campaign_ids | bigint[] | EVERY campaign the order's products touch. Use for "orders that include anything from campaign X". |
| campaigns_text | text | Readable comma-list of all campaigns on the order. |
| products_text | text | Readable product summary, e.g. "Blu-ray Package ×1, Digital ×2". Good for ILIKE. |
| products | jsonb | Array of {name, variant, qty, campaign_id}. Use @> for precise containment. |

Campaign registry (id → name):
- 1 = The Thing Expanded
- 2 = In Search of Darkness 1995
- 3 = FPS: First Person Shooter
- 4 = Aliens Expanded 40th Anniversary
- 5 = TerrorBytes
- 7 = In Search Of Darkness 70s

Rules for the SQL you generate:
1. Revenue/spend questions default to WHERE status = 'paid' unless the user explicitly asks about refunds, disputes, or "all" orders. Always sum amount_usd, never amount.
2. "Orders for / from campaign X" → primary_campaign_id = X.  "Orders that include / contain anything from campaign X" → campaign_ids @> ARRAY[X]. When unsure which the user means, prefer campaign_ids @> (it's the superset) and say so.
3. Product filters: simple/loose → products_text ILIKE '%term%'. Precise → products @> '[{"name":"Exact Name"}]'::jsonb.
4. Map campaign names in the user's question to ids using the registry above before filtering.
5. One order can span multiple campaigns; its full amount_usd is counted once against its primary campaign. So per-campaign revenue from this view is approximate for mixed-cart orders. If the user needs exact per-product unit counts or exact per-campaign revenue splits, tell them that lives in aa_01_campaigns.v_raw_order_line_attribution (live Shopify only) — do not try to compute it from this view.
6. Counting customers → COUNT(DISTINCT email). Counting orders → COUNT(*) or COUNT(DISTINCT order_key).
7. Keep results bounded (add LIMIT for row-listing questions; aggregates don't need it).

Known soft spots (mention only if relevant to the answer):
- 216 ISOD orders have no line items → NULL amount and empty products.
- ISOD status is assumed paid (the source carries no status field).
- A handful of Gumroad rows from the live feed can show 0.00 totals.

Output ONLY the SQL — no markdown fences, no commentary, no explanations.
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

// Strip code fences with any (or no) language label. The matcher
// returns JSON, the generator returns SQL — Claude occasionally
// wraps either in ```json / ```sql / ```postgresql / bare ``` fences
// despite instructions to skip them.
function stripCodeFences(s: string): string {
  let t = s.trim()
  t = t.replace(/^```[a-zA-Z0-9_-]*\s*\n?/i, '')
  t = t.replace(/\n?\s*```\s*$/i, '')
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
