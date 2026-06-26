#!/usr/bin/env node
// Replay Shopify orders from the Admin REST API through the
// shopify-webhook Edge Function. Idempotent — the function upserts
// raw_orders on shopify_order_id and campaign_orders on
// (source, source_order_id), so re-running over the same window just
// re-confirms what's already stored.
//
// Pulls REST (legacy-but-functional) so payload shape matches the
// webhook the function already parses. GraphQL would require a
// transform step.
//
// USAGE
//   SHOPIFY_STORE_DOMAIN=creatorvc.myshopify.com \
//   SHOPIFY_ADMIN_TOKEN=shpat_xxx \
//   SHOPIFY_WEBHOOK_SECRET=xxx \
//   SHOPIFY_WEBHOOK_URL=https://xwokhafcllstcnlcberv.functions.supabase.co/shopify-webhook \
//     node scripts/replay-shopify-orders.mjs --since 2026-05-12T00:00:00Z
//
// FLAGS
//   --since   ISO-8601 floor (default 2026-05-12T00:00:00Z)
//   --until   ISO-8601 ceiling (optional)
//   --dry-run Pull + count, do NOT post to the webhook
//   --concurrency N (default 5)
//   --limit N Stop after N orders (for spot-checks)
//
// EXIT
//   0 if no per-order failures, 1 otherwise. Final stats printed.

import crypto from 'node:crypto'

// ── Config ───────────────────────────────────────────────────────
const args = process.argv.slice(2)
function flag(name, dflt = null) {
  const i = args.indexOf(name)
  if (i === -1) return dflt
  const next = args[i + 1]
  return next && !next.startsWith('--') ? next : true
}

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN
const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET
const WEBHOOK_URL = process.env.SHOPIFY_WEBHOOK_URL
const API_VERSION = process.env.SHOPIFY_API_VERSION ?? '2026-01'

const SINCE = flag('--since', '2026-05-12T00:00:00Z')
const UNTIL = flag('--until', null)
const DRY_RUN = flag('--dry-run', false) === true
const CONCURRENCY = Number(flag('--concurrency', '5'))
const LIMIT = flag('--limit', null) ? Number(flag('--limit')) : Infinity

const missing = []
if (!STORE_DOMAIN) missing.push('SHOPIFY_STORE_DOMAIN')
if (!ADMIN_TOKEN) missing.push('SHOPIFY_ADMIN_TOKEN')
if (!DRY_RUN && !WEBHOOK_SECRET) missing.push('SHOPIFY_WEBHOOK_SECRET')
if (!DRY_RUN && !WEBHOOK_URL) missing.push('SHOPIFY_WEBHOOK_URL')
if (missing.length) {
  console.error('Missing required env:', missing.join(', '))
  process.exit(2)
}

// ── Helpers ──────────────────────────────────────────────────────
function shopifyHmacBase64(body, secret) {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// Parse Link header to find the next-page cursor (REST page_info).
function nextPageInfo(linkHeader) {
  if (!linkHeader) return null
  // e.g.  <https://...?limit=250&page_info=eyJsYXN0X2lk...>; rel="next"
  const parts = linkHeader.split(',')
  for (const p of parts) {
    const m = p.match(/<([^>]+)>;\s*rel="next"/)
    if (m) {
      const url = new URL(m[1])
      return url.searchParams.get('page_info')
    }
  }
  return null
}

// ── Pull ─────────────────────────────────────────────────────────
async function fetchPage({ pageInfo, sinceIso, untilIso }) {
  const base = `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/orders.json`
  const url = new URL(base)
  if (pageInfo) {
    // Per Shopify docs, when page_info is set the only allowed extras
    // are limit + fields. Pull everything; that's what the webhook gets.
    url.searchParams.set('page_info', pageInfo)
    url.searchParams.set('limit', '250')
  } else {
    url.searchParams.set('status', 'any')
    url.searchParams.set('limit', '250')
    url.searchParams.set('created_at_min', sinceIso)
    if (untilIso) url.searchParams.set('created_at_max', untilIso)
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': ADMIN_TOKEN,
        'Content-Type': 'application/json',
      },
    })
    if (res.status === 429 || res.status >= 500) {
      const backoff = 500 * 2 ** attempt
      console.warn(`[pull] ${res.status} on ${url.pathname} — backing off ${backoff}ms`)
      await sleep(backoff)
      continue
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Shopify GET orders ${res.status}: ${body.slice(0, 300)}`)
    }
    const json = await res.json()
    return { orders: json.orders ?? [], nextPage: nextPageInfo(res.headers.get('link')) }
  }
  throw new Error(`Shopify GET orders exhausted retries`)
}

// ── Replay ───────────────────────────────────────────────────────
async function replayOne(order) {
  const body = JSON.stringify(order)
  const hmac = shopifyHmacBase64(body, WEBHOOK_SECRET)
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Topic': 'orders/create',
        'X-Shopify-Shop-Domain': STORE_DOMAIN,
        'X-Shopify-Hmac-Sha256': hmac,
        'X-Shopify-Webhook-Id': `backfill:${order.id}`,
      },
      body,
    })
    if (res.status === 429 || res.status >= 500) {
      const backoff = 400 * 2 ** attempt
      await sleep(backoff)
      continue
    }
    const text = await res.text().catch(() => '')
    return { ok: res.ok, status: res.status, body: text.slice(0, 500) }
  }
  return { ok: false, status: 0, body: 'retries exhausted' }
}

async function runWithConcurrency(items, n, worker) {
  const results = []
  let cursor = 0
  let inFlight = 0
  return new Promise((resolve) => {
    const tick = () => {
      while (inFlight < n && cursor < items.length) {
        const idx = cursor++
        inFlight++
        worker(items[idx], idx).then((r) => {
          results[idx] = r
          inFlight--
          if (cursor >= items.length && inFlight === 0) resolve(results)
          else tick()
        })
      }
      if (items.length === 0) resolve(results)
    }
    tick()
  })
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log(`replay-shopify-orders`)
  console.log(`  store:       ${STORE_DOMAIN}`)
  console.log(`  api:         ${API_VERSION}`)
  console.log(`  since:       ${SINCE}`)
  if (UNTIL) console.log(`  until:       ${UNTIL}`)
  console.log(`  dry-run:     ${DRY_RUN}`)
  console.log(`  concurrency: ${CONCURRENCY}`)
  if (LIMIT !== Infinity) console.log(`  limit:       ${LIMIT}`)
  console.log()

  let pulled = 0
  let posted200 = 0
  let postedNon200 = 0
  const failures = []
  let pageInfo = null
  let pageN = 0

  while (true) {
    pageN++
    const { orders, nextPage } = await fetchPage({ pageInfo, sinceIso: SINCE, untilIso: UNTIL })
    if (orders.length === 0) {
      console.log(`page ${pageN}: 0 orders (done)`)
      break
    }
    pulled += orders.length
    const slice = pulled <= LIMIT ? orders : orders.slice(0, orders.length - (pulled - LIMIT))
    console.log(`page ${pageN}: pulled ${orders.length} (running total: ${Math.min(pulled, LIMIT)})`)

    if (!DRY_RUN) {
      const results = await runWithConcurrency(slice, CONCURRENCY, replayOne)
      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        if (r.ok) posted200++
        else {
          postedNon200++
          failures.push({ id: slice[i].id, name: slice[i].name, status: r.status, body: r.body })
        }
      }
      console.log(`  posted: ${posted200} ok / ${postedNon200} fail (cumulative)`)
    }

    if (pulled >= LIMIT) {
      console.log(`reached --limit ${LIMIT}, stopping`)
      break
    }
    if (!nextPage) {
      console.log(`page ${pageN}: no next-page cursor (done)`)
      break
    }
    pageInfo = nextPage
  }

  console.log()
  console.log(`────────────────────────`)
  console.log(`pulled:     ${pulled}`)
  if (!DRY_RUN) {
    console.log(`posted 200: ${posted200}`)
    console.log(`posted !2xx: ${postedNon200}`)
    if (failures.length) {
      console.log()
      console.log(`First ${Math.min(failures.length, 10)} failures:`)
      for (const f of failures.slice(0, 10)) {
        console.log(`  #${f.name ?? f.id} [${f.status}]: ${f.body}`)
      }
    }
  }
  process.exit(failures.length ? 1 : 0)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(2)
})
