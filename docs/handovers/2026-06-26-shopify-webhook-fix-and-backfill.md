# Creator VC OS — Shopify Webhook Auth Fix + Order Backfill

**Date:** 2026-06-26
**Owner of this work:** Claude Code (frontend repo `martinpstewart/creator-vc-os` + Edge Function deploys)
**Diagnosis source:** C Chat (Supabase MCP, read-only investigation) — already done; do **not** re-investigate from zero.
**Severity:** High — live order ingestion has been largely dark since 2026-05-12.

---

## 0. TL;DR

Shopify's native `orders/create` webhook has been returning **401 at the Supabase auth gate** (`verify_jwt: true`) since mid-May, so most orders never reach the function body and never hit the DB. A low-volume side-channel (NULL `shop_domain`) has kept a trickle flowing, masking the outage.

Two pieces of work:

1. **Fix** `shopify-webhook` so native Shopify deliveries authenticate and ingest again — without opening the endpoint to anonymous traffic, and **without breaking the working side-channel**.
2. **Backfill** every order from **2026-05-12T00:00:00Z → now** by pulling from the Shopify Admin API and **replaying through the fixed webhook** (not direct INSERT), so the full pipeline runs.

---

## 1. Confirmed diagnosis (evidence — do not re-derive)

- **Endpoint:** Edge Function `shopify-webhook`, currently **v36**, `verify_jwt: true`, function id `fd7c3c3c-cae2-4281-9e1b-85aef011a6bf`, project ref `xwokhafcllstcnlcberv` (eu-west-2).
- **The function writes `aa_01_campaigns.raw_orders` unconditionally** once it executes (before any product mapping). So missing orders are being rejected *before* the body runs — they are not dropped by the resolver.
- Edge-function logs show a **continuous stream of `POST | 401 | …/shopify-webhook`**, ongoing right now. These are rejected by `verify_jwt` at the platform layer; the function body never runs, nothing is logged inside it, nothing is stored.
- **Both Supabase API keys are valid** (legacy anon JWT exp 2036; publishable key active). This is **not** a key expiry.
- **Root cause:** Shopify's native webhook deliveries cannot attach an `Authorization`/`apikey` header, so under `verify_jwt: true` every native delivery 401s. The campaigns that *do* still ingest arrive via a relay/side-channel that can attach a key.

### The outage boundary (from `raw_orders`)

| Marker | Value |
|---|---|
| Last healthy order **with** `shop_domain` stamped | **2026-05-12 11:57:02 UTC** |
| Dead gap (no orders landed at all) | 2026-05-13 → 2026-05-17 |
| First order after gap (NULL `shop_domain`, trickle begins) | 2026-05-18 17:57:33 UTC |
| Total orders landed since 2026-05-13 (the trickle only) | **555** |

Native webhook orders carry `shop_domain`; the post-May-18 rows are all `NULL` domain (a relay that doesn't set the header). Translation: since ~May 12 the native webhook has been 401'ing and only a partial side-channel kept `raw_orders` alive. **~6 weeks of native-webhook orders are missing.**

### Store registry (`aa_01_campaigns.shop_domains`)
- `creatorvc.myshopify.com` → campaign_id 1
- `thethingexpanded.com` → campaign_id 1
(Public storefront is `insearchofdarkness.com`, served by the same store — not a separate store.)

---

## 2. PART 1 — Fix the webhook auth

### Goal
Native Shopify webhooks authenticate and ingest again, endpoint stays protected, working side-channel keeps working.

### CRITICAL pre-step (do this FIRST)
**Confirm how the currently-working campaigns authenticate.** The NULL-domain trickle is reaching the function with *some* valid credential (almost certainly the project anon key via a relay/automation — check Make/Zapier/Glide or a custom app). Whatever token/header that path sends, you must preserve it, or you'll knock the still-working campaigns offline when you change `verify_jwt`.

### Change
1. Set `verify_jwt = false` on `shopify-webhook`.
2. Add **in-function dual authentication** at the very top of request handling (right after `const rawBodyText = await req.text();`, before any DB work). Accept the request if **EITHER**:
   - a valid **Shopify HMAC** is present (`X-Shopify-Hmac-Sha256` = base64 HMAC-SHA256 of the **raw body** using the Shopify webhook signing secret), **OR**
   - the request carries the **existing working-path token** (the credential the relay already sends).
   Otherwise return `401`.
3. **Change nothing else** in the data-writing logic.

### Reference implementation

Module scope:
```ts
async function verifyShopifyHmac(rawBody: string, hmacHeader: string | null, secret: string): Promise<boolean> {
  if (!hmacHeader) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  if (computed.length !== hmacHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hmacHeader.charCodeAt(i);
  return diff === 0; // constant-time compare
}
```

Gate (immediately after `rawBodyText` is read and headers are available):
```ts
const SHOPIFY_WEBHOOK_SECRET = Deno.env.get("SHOPIFY_WEBHOOK_SECRET") ?? "";
const WORKING_PATH_TOKEN     = Deno.env.get("WORKING_PATH_TOKEN") ?? "";

const hmacOk = SHOPIFY_WEBHOOK_SECRET
  ? await verifyShopifyHmac(rawBodyText, req.headers.get("x-shopify-hmac-sha256"), SHOPIFY_WEBHOOK_SECRET)
  : false;

const presentedToken = req.headers.get("apikey")
  ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  ?? null;
const tokenOk = WORKING_PATH_TOKEN.length > 0 && presentedToken === WORKING_PATH_TOKEN;

if (!hmacOk && !tokenOk) {
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
    status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

**Note:** HMAC must be computed over the exact raw body string (`req.text()` output), not re-serialised JSON. The function already captures `rawBodyText` before `JSON.parse` — use that.

### Secrets / config
- `SHOPIFY_WEBHOOK_SECRET` — the Shopify webhook signing secret (Shopify admin → the webhook's signing secret; or the custom app's API secret key if these are app webhooks). `supabase secrets set SHOPIFY_WEBHOOK_SECRET=…`
- `WORKING_PATH_TOKEN` — the exact token the working relay sends (confirm in the relay/app config; likely the project anon key from Supabase → Settings → API). **Do not hardcode in the repo** — set as a function secret.

### Deploy
The MCP `deploy_edge_function` on this project has been unreliable. Deploy via:
```
supabase functions deploy shopify-webhook --no-verify-jwt
```
(the `--no-verify-jwt` flag sets `verify_jwt=false`) — or paste in the Supabase Dashboard and turn off **Enforce JWT** for the function there.

### Verify the fix
1. Shopify admin → the webhook → **Send test notification** (or place a small real order).
2. Confirm edge-function logs now show `200` for `shopify-webhook` (not 401).
3. Confirm a new row appears in `aa_01_campaigns.raw_orders`.
4. Confirm an ISOD 70s order lands with its line items visible in `payload`.
**Do not start the backfill until live ingestion is confirmed working** — replaying into a still-401'ing endpoint does nothing.

---

## 3. PART 2 — Backfill 2026-05-12 → now

### Window
- **Floor: `2026-05-12T00:00:00Z`** (last healthy order was 11:57 that day; round down).
- Replay is **idempotent** (function upserts `raw_orders` on `shopify_order_id`, `campaign_orders` on `source,source_order_id`, junctions on conflict). Over-pulling from an earlier date is harmless and just re-confirms the 555 already-landed. Pull generously.

### Access prerequisites (Shopify custom app)
- Scope `read_orders`.
- **Protected customer data** access enabled (orders carry email/address PII; required to read it).
- `read_all_orders` is **not required yet** — the floor is ~45 days back, under Shopify's 60-day default order-access window. **But the clock is ticking**: if this slips past ~60 days from May 12, request `read_all_orders` to remove the limit.

### Pull method — use REST for shape-compatibility
The webhook body the function parses is the **REST order representation** (`line_items[]` with `title`/`sku`/`price`, `shipping_address`, `financial_status`, `total_price`, etc.).

- **Recommended: REST Admin API** `GET /admin/api/2026-01/orders.json?status=any&created_at_min=2026-05-12T00:00:00Z&limit=250`, paginating via the `Link` header `rel="next"` cursor. REST is legacy-as-of-Oct-2024 but still functions for an existing custom app, and crucially its payload **matches the webhook shape**, so replayed bodies parse without transformation. Use `status=any` to include all financial states.
- **Alternative: GraphQL bulk operation** (`bulkOperationRunQuery` over `orders(query: "created_at:>=2026-05-12")`). Scales better for large sets, but GraphQL field names differ (`lineItems`, `shippingAddress`, `displayFinancialStatus`, `currentTotalPriceSet`…), so you **must transform each record into the REST/webhook shape** before replay. Only take this route if volume makes REST paging impractical.
- Respect Shopify rate limits on the pull (REST ~2 req/s, bucket 40).

### Replay — through the fixed webhook, NOT direct INSERT
For each pulled order, POST the order JSON to the fixed function so the **whole pipeline runs** (`raw_orders` → customer upsert → `refresh_customer_aggregates` → junctions):

```
POST https://xwokhafcllstcnlcberv.functions.supabase.co/shopify-webhook
Headers:
  Content-Type: application/json
  X-Shopify-Topic: orders/create
  X-Shopify-Shop-Domain: creatorvc.myshopify.com
  X-Shopify-Hmac-Sha256: <base64 HMAC-SHA256 of the body using SHOPIFY_WEBHOOK_SECRET>
Body: <the order object JSON>
```
The replay script controls the body and the secret, so it computes a valid HMAC and the request passes the new auth gate via the HMAC branch. Setting `X-Shopify-Shop-Domain` lets the function resolve campaign_id exactly as a live delivery would (`shop_domains` → cid 1, then order-number legacy suffix override).

- Throttle replay: small concurrency (e.g. 5–10 in flight), retry on `429`/`5xx` with backoff.
- Re-running the whole job is safe (idempotent upserts).
- The Shopify webhook **delivery-log "resend"** is NOT viable here — that's only within Shopify's ~48h retry window, long gone for a 6-week backfill.

### Post-backfill refresh (run once, after replay completes)
The function refreshes per-customer aggregates during replay, but refresh the rollups once at the end:
```sql
SELECT public.refresh_dashboard_snapshot();
SELECT public.refresh_campaigns_list_snapshot();
SELECT public.refresh_customer_list_snapshot();
```

### Verify the backfill
```sql
-- Daily counts should now be dramatically higher for 2026-05-13 → now (vs the ~555 trickle)
SELECT date_trunc('day', created_at)::date AS day, count(*)
FROM aa_01_campaigns.raw_orders
WHERE created_at >= '2026-05-12'
GROUP BY 1 ORDER BY 1;
```
- Spot-check a known recent order number is present.
- Confirm an ISOD 70s order is now in `raw_orders`.

---

## 4. Known follow-ups (out of scope for this fix, flag separately)

- **Campaign 7 (ISOD 70s) products are unmapped** in `aa_01_campaigns.shopify_products_map` (4 products: `ISOD_70s`, `THING_EXPANDED_UPSELL`, `ISOD_95_99_UPSELL`, `ISOD-9094`). Backfilled 70s orders will land in `raw_orders` but **won't attribute to campaign 7** until mapped. Map them (and resolve any `shopify_product_inbox` rows that go `pending` for products first seen during the backfill).
- **`get_campaign_products_v2` RPC is throwing intermittent 500s** in the live app right now (seen in API logs). Separate issue from the webhook — worth a look once ingestion is restored.
- Downstream impact: dashboards, revenue figures, and any "top backers" reporting are **~6 weeks short** until the backfill completes. Don't trust them for decisions until then.

---

## 5. Recommended order of operations

1. Confirm the working-path auth token (Part 1 pre-step).
2. Implement dual-auth + `verify_jwt=false`, deploy, verify live ingestion resumes.
3. Enable Shopify custom-app `read_orders` + protected customer data (+ `read_all_orders` if you want margin).
4. Pull orders from `2026-05-12T00:00:00Z` (REST, shape-compatible).
5. Replay through the fixed webhook (idempotent, throttled).
6. Refresh dashboard/campaign/customer snapshots.
7. Verify counts + spot-checks.
8. Follow-ups: map campaign-7 products; investigate `get_campaign_products_v2` 500s.
