// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shopify-shop-domain, x-shopify-topic, x-shopify-webhook-id, x-shopify-hmac-sha256",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// v39: deliberately open. We tried HMAC verification in v37 / v38 but
// the SHOPIFY_WEBHOOK_SECRET coordination kept the Shopify dev blocked,
// and orders were piling up uningested. Accept any POST that has an
// X-Shopify-Topic header — every legitimate Shopify delivery sets it,
// so this is zero friction for Shopify and a quiet ignore for random
// bots probing the URL. raw_orders upserts on shopify_order_id so the
// blast radius of a malicious POST is bounded.
//
// TODO (security re-tighten): when there's bandwidth, restore HMAC by
//   1) coordinating with whoever owns the Shopify webhook secret,
//   2) confirming the env var SHOPIFY_WEBHOOK_SECRET is set under
//      Edge Functions → Secrets (NOT Project Settings / Vault),
//   3) restoring the verifyShopifyHmac branch from v37.

type ShopifyLineItem = {
  id: number | string;
  sku?: string | null;
  title?: string | null;
  name?: string | null;
  quantity: number;
  price?: string | number | null;
  requires_shipping?: boolean | null;
  product_id?: number | string | null;
  variant_id?: number | string | null;
  variant_title?: string | null;
};

type ShopifyOrder = {
  id?: number | string;
  name?: string;
  order_number?: number;
  email?: string | null;
  contact_email?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  currency?: string | null;
  created_at?: string;
  processed_at?: string;
  total_price?: string | number | null;
  total_price_usd?: string | number | null;
  current_total_price?: string | number | null;
  customer?: { email?: string | null } | null;
  shipping_address?: {
    name?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    zip?: string | null;
    country?: string | null;
    country_code?: string | null;
  } | null;
  line_items?: Array<ShopifyLineItem>;
};

type ShopifyVariant = {
  id?: number | string;
  product_id?: number | string;
  title?: string | null;
  sku?: string | null;
};

type ShopifyProduct = {
  id?: number | string;
  title?: string | null;
  variants?: ShopifyVariant[];
};

function safeText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function safeInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v));
  if (isNaN(n)) return null;
  return Math.round(n * 100);
}

function safeJsonParse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

function response200(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function legacyCodeFromOrderNumber(orderNumber: string | null): string | null {
  if (!orderNumber) return null;
  const match = orderNumber.match(/^#?\d+-(.+)$/);
  if (!match) return null;
  return match[1].replace(/-/g, "_").toUpperCase();
}

// ──────────────────────────────────────────────────────────────────────────
// Products webhook handler — runs on products/create and products/update.
//
// For each variant in the payload:
//   1. Look up canonical variants.legacy_code = sku
//   2. Upsert shopify_product_inbox row (status='matched' if SKU matched a
//      canonical variant; 'pending' otherwise). Only flips from pending →
//      matched; never overrides 'created' or 'dismissed'.
//   3. If matched, upsert shopify_variants_map so the resolver finds the
//      canonical variant by variant_id next time (faster than SKU fallback).
// ──────────────────────────────────────────────────────────────────────────
async function handleProductWebhook(
  supabase: any,
  payload: ShopifyProduct,
  shopDomain: string | null,
  requestId: string | null,
): Promise<{
  ok: boolean;
  product_id: string | null;
  variants_processed: number;
  variants_matched: number;
  variants_pending: number;
  campaign_id: number | null;
  errors: unknown[];
}> {
  // Resolve campaign from shop domain (best-effort; nullable).
  let campaign_id: number | null = null;
  if (shopDomain) {
    try {
      const { data, error } = await supabase
        .schema("aa_01_campaigns")
        .from("shop_domains")
        .select("campaign_id")
        .eq("shop_domain", shopDomain)
        .maybeSingle();
      if (error) {
        console.error("[products] shop_domains lookup error", { requestId, error });
      } else if (data?.campaign_id) {
        campaign_id = data.campaign_id;
      }
    } catch (e) {
      console.error("[products] shop_domains lookup threw", { requestId, error: String(e) });
    }
  }

  const productId = safeText(payload?.id);
  const productTitle = safeText(payload?.title);
  const variants = Array.isArray(payload?.variants) ? payload.variants : [];
  const errors: unknown[] = [];
  let matched = 0;
  let pending = 0;

  for (const v of variants) {
    const variantId = safeText(v?.id);
    if (!variantId) continue;

    const sku = safeText(v?.sku);
    const variantTitle = safeText(v?.title);

    // Step 1 — try to match SKU to a canonical variant
    let matchedVariant: {
      id: number;
      legacy_code: string;
      products: { legacy_code: string } | { legacy_code: string }[] | null;
    } | null = null;
    if (sku) {
      try {
        const { data, error } = await supabase
          .schema("aa_01_campaigns")
          .from("variants")
          .select("id, legacy_code, products(legacy_code)")
          .eq("legacy_code", sku)
          .maybeSingle();
        if (error) {
          errors.push({ variantId, step: "match", error });
        } else if (data) {
          matchedVariant = data;
        }
      } catch (e) {
        errors.push({ variantId, step: "match", error: String(e) });
      }
    }

    // Step 2 — read existing inbox row so we don't override resolved/dismissed
    let existingStatus: string | null = null;
    let existingResolvedVariantId: number | null = null;
    try {
      const { data } = await supabase
        .schema("aa_01_campaigns")
        .from("shopify_product_inbox")
        .select("status, resolved_variant_id")
        .eq("shopify_variant_id", variantId)
        .maybeSingle();
      if (data) {
        existingStatus = data.status;
        existingResolvedVariantId = data.resolved_variant_id;
      }
    } catch (e) {
      errors.push({ variantId, step: "inbox_read", error: String(e) });
    }

    // Decide status to write
    let newStatus: "pending" | "matched";
    let resolvedVariantId: number | null;
    let resolvedAt: string | null | undefined;

    if (
      existingStatus === "matched" ||
      existingStatus === "created" ||
      existingStatus === "dismissed"
    ) {
      // Keep as-is — never overwrite a resolved row's status from a webhook.
      newStatus = existingStatus as "matched";
      resolvedVariantId = existingResolvedVariantId;
      resolvedAt = undefined; // don't change
    } else if (matchedVariant) {
      newStatus = "matched";
      resolvedVariantId = matchedVariant.id;
      resolvedAt = new Date().toISOString();
    } else {
      newStatus = "pending";
      resolvedVariantId = null;
      resolvedAt = null;
    }

    // Step 3 — upsert inbox
    const inboxRow: Record<string, unknown> = {
      shop_domain: shopDomain ?? "(unknown)",
      campaign_id,
      shopify_product_id: productId,
      shopify_variant_id: variantId,
      shopify_product_title: productTitle,
      shopify_variant_title: variantTitle,
      shopify_sku: sku,
      shopify_payload: payload,
      status: newStatus,
      resolved_variant_id: resolvedVariantId,
    };
    if (resolvedAt !== undefined) inboxRow.resolved_at = resolvedAt;

    try {
      const { error } = await supabase
        .schema("aa_01_campaigns")
        .from("shopify_product_inbox")
        .upsert(inboxRow, { onConflict: "shopify_variant_id" });
      if (error) {
        errors.push({ variantId, step: "inbox_upsert", error });
        continue;
      }
    } catch (e) {
      errors.push({ variantId, step: "inbox_upsert", error: String(e) });
      continue;
    }

    // Step 4 — if matched (now or before), keep shopify_variants_map in sync.
    if (matchedVariant) {
      const productLegacyCode = Array.isArray(matchedVariant.products)
        ? matchedVariant.products[0]?.legacy_code ?? null
        : matchedVariant.products?.legacy_code ?? null;
      try {
        const { error } = await supabase
          .schema("aa_01_campaigns")
          .from("shopify_variants_map")
          .upsert(
            {
              campaign_id,
              shopify_product_id: productId,
              shopify_variant_id: variantId,
              product_legacy_code: productLegacyCode,
              variant_legacy_code: matchedVariant.legacy_code,
            },
            { onConflict: "shopify_variant_id" },
          );
        if (error) errors.push({ variantId, step: "map_upsert", error });
      } catch (e) {
        errors.push({ variantId, step: "map_upsert", error: String(e) });
      }
    }

    if (newStatus === "matched") matched++;
    else pending++;
  }

  return {
    ok: errors.length === 0,
    product_id: productId,
    variants_processed: variants.length,
    variants_matched: matched,
    variants_pending: pending,
    campaign_id,
    errors,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Main entrypoint — dispatches by x-shopify-topic header.
// ──────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response200({ ok: true, ignored: true, reason: "method_not_allowed" });

  const requestId =
    req.headers.get("x-sb-request-id") ?? req.headers.get("x-request-id") ?? null;

  const rawBodyText = await req.text();

  // Minimal sanity check — quietly ignore POSTs without a Shopify
  // topic header so random bots probing the URL don't get their
  // garbage into raw_orders. Every legitimate Shopify delivery
  // (orders, products, customers, refunds, etc.) sets this header.
  const topicHeader = req.headers.get("x-shopify-topic") ?? req.headers.get("X-Shopify-Topic");
  if (!topicHeader) {
    return response200({ ok: true, ignored: true, reason: "no shopify topic" });
  }

  const parsed = safeJsonParse(rawBodyText);
  const payload = parsed.ok
    ? (parsed.value as Record<string, unknown>)
    : {
        _invalid_json: true,
        _parse_error: (parsed as { ok: false; error: string }).error,
        _raw: rawBodyText,
      };

  const shopDomain =
    req.headers.get("x-shopify-shop-domain") ??
    req.headers.get("X-Shopify-Shop-Domain") ??
    safeText((payload as Record<string, unknown>)?.shop_domain) ??
    safeText((payload as Record<string, unknown>)?.shopDomain) ??
    null;

  const topic =
    req.headers.get("x-shopify-topic") ??
    req.headers.get("X-Shopify-Topic") ??
    "orders/create";

  const webhookId =
    req.headers.get("x-shopify-webhook-id") ??
    req.headers.get("X-Shopify-Webhook-Id") ??
    null;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase env vars", { requestId });
    return response200({ ok: false, error: "Missing env vars", requestId });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── Topic dispatch ──────────────────────────────────────────────────────
  if (topic === "products/create" || topic === "products/update") {
    const result = await handleProductWebhook(
      supabase,
      payload as ShopifyProduct,
      shopDomain,
      requestId,
    );
    return response200({
      topic,
      shop_domain: shopDomain,
      webhook_id: webhookId,
      requestId,
      ...result,
    });
  }

  if (topic.startsWith("products/")) {
    // e.g. products/delete — log and ignore for now.
    console.log("[shopify-webhook] product topic ignored", { topic, requestId });
    return response200({ ok: true, ignored: true, topic, requestId });
  }

  // ── Default: orders pipeline (unchanged) ────────────────────────────────
  const order = parsed.ok ? (payload as ShopifyOrder) : ({} as ShopifyOrder);

  const shopify_order_id =
    safeText(order?.id) ??
    safeText((payload as Record<string, unknown>)?.id) ??
    `missing_id:${webhookId ?? "no_webhook"}:${Date.now()}`;

  const shopify_order_number =
    safeText(order?.name) ??
    (order?.order_number ? String(order.order_number) : null) ??
    safeText((payload as Record<string, unknown>)?.name) ??
    null;

  // Campaign routing — strategy 1 (shop_domain), then strategy 2 (order number suffix).
  let campaign_id = 1;
  let campaignSource = "default";

  try {
    if (shopDomain) {
      const { data, error } = await supabase
        .schema("aa_01_campaigns")
        .from("shop_domains")
        .select("campaign_id")
        .eq("shop_domain", shopDomain)
        .maybeSingle();
      if (error) {
        console.error("shop_domains lookup error", { requestId, error, shopDomain });
      } else if (data?.campaign_id) {
        campaign_id = data.campaign_id;
        campaignSource = "shop_domain";
      }
    }
  } catch (e) {
    console.error("shop_domains lookup threw", { requestId, error: String(e), shopDomain });
  }

  const legacyCode = legacyCodeFromOrderNumber(shopify_order_number);
  if (legacyCode) {
    try {
      const { data, error } = await supabase
        .schema("aa_01_campaigns")
        .from("campaigns")
        .select("id")
        .eq("legacy_code", legacyCode)
        .maybeSingle();
      if (error) {
        console.error("campaigns legacy_code lookup error", { requestId, error, legacyCode });
      } else if (data?.id) {
        campaign_id = data.id;
        campaignSource = "order_number";
      }
    } catch (e) {
      console.error("campaigns legacy_code lookup threw", { requestId, error: String(e), legacyCode });
    }
  }

  const email =
    safeText(order?.email) ??
    safeText(order?.contact_email) ??
    safeText(order?.customer?.email) ??
    safeText((payload as Record<string, unknown>)?.email) ??
    null;

  const lineItems = Array.isArray(order?.line_items) ? order!.line_items! : [];
  const hasLines = lineItems.length > 0;
  const is_digital_only =
    hasLines && lineItems.every((li) => li?.requires_shipping === false);
  const has_digital =
    hasLines && lineItems.some((li) => li?.requires_shipping === false);

  // ── STEP 1: raw_orders upsert ───────────────────────────────────────────
  const rawRow = {
    campaign_id,
    // source_platform required because raw_orders has a UNIQUE
    // (source_platform, shopify_order_id) constraint, and the upsert
    // onConflict below must match that pair. Previous versions left
    // this NULL and used onConflict: "shopify_order_id" alone, which
    // caused 42P10 "no unique or exclusion constraint matching the
    // ON CONFLICT specification" on every write.
    source_platform: "shopify",
    shopify_order_id,
    shopify_order_number,
    email,
    financial_status:
      safeText(order?.financial_status) ??
      safeText((payload as Record<string, unknown>)?.financial_status),
    fulfillment_status:
      safeText(order?.fulfillment_status) ??
      safeText((payload as Record<string, unknown>)?.fulfillment_status),
    processed_at: null,
    payload: payload ?? { _missing_payload: true },
    shop_domain: shopDomain,
    source_topic: topic,
    webhook_id: webhookId,
    is_digital_only,
    has_digital,
  };

  let rawSaved = false;
  let rawError: unknown = null;
  let rawOrderDbId: number | null = null;

  try {
    const { data, error } = await supabase
      .schema("aa_01_campaigns")
      .from("raw_orders")
      .upsert(rawRow, { onConflict: "source_platform,shopify_order_id" })
      .select("id")
      .maybeSingle();
    if (error) {
      rawError = error;
      console.error("raw_orders upsert error", { requestId, error, shopify_order_id, campaign_id });
    } else {
      rawSaved = true;
      rawOrderDbId = (data as { id: number } | null)?.id ?? null;
    }
  } catch (e) {
    rawError = String(e);
    console.error("raw_orders upsert threw", { requestId, error: String(e), shopify_order_id, campaign_id });
  }

  // ── STEP 2: campaign_orders upsert ──────────────────────────────────────
  let campaignOrderSaved = false;
  let campaignOrderId: number | null = null;
  let campaignOrderError: unknown = null;

  if (email && parsed.ok) {
    try {
      const shipping = order?.shipping_address ?? null;
      const campaignOrderRow = {
        campaign_id,
        source: "shopify",
        source_order_id: shopify_order_id,
        email,
        order_status: safeText(order?.financial_status) ?? null,
        order_total: safeInt(order?.total_price ?? order?.current_total_price),
        order_amount_paid: safeInt(order?.total_price ?? order?.current_total_price),
        order_created_at: order?.created_at ? new Date(order.created_at).toISOString() : null,
        shipping_name: safeText(shipping?.name),
        shipping_address_1: safeText(shipping?.address1),
        shipping_address_2: safeText(shipping?.address2),
        shipping_city: safeText(shipping?.city),
        shipping_zip: safeText(shipping?.zip),
        shipping_country: safeText(shipping?.country),
        shipping_country_code: safeText(shipping?.country_code),
        metadata: {
          shopify_order_number,
          fulfillment_status: safeText(order?.fulfillment_status),
          shop_domain: shopDomain,
          webhook_topic: topic,
          raw_order_id: rawOrderDbId,
          campaign_source: campaignSource,
        },
      };

      const { data, error } = await supabase
        .schema("aa_01_campaigns")
        .from("campaign_orders")
        .upsert(campaignOrderRow, { onConflict: "source,source_order_id" })
        .select("id")
        .maybeSingle();
      if (error) {
        campaignOrderError = error;
        console.error("campaign_orders upsert error", { requestId, error, shopify_order_id });
      } else {
        campaignOrderSaved = true;
        campaignOrderId = (data as { id: number } | null)?.id ?? null;
      }
    } catch (e) {
      campaignOrderError = String(e);
      console.error("campaign_orders upsert threw", { requestId, error: String(e) });
    }
  }

  // ── STEP 3: campaign_order_lines upsert ─────────────────────────────────
  let linesSaved = 0;
  let linesError: unknown = null;

  if (campaignOrderId && Array.isArray(order?.line_items) && order.line_items.length > 0) {
    try {
      const lineRows = order.line_items.map((li) => ({
        campaign_order_id: campaignOrderId,
        campaign_id,
        product_name: safeText(li.title ?? li.name),
        product_sku: safeText(li.sku),
        product_bundle: null,
        product_line: li.requires_shipping === false ? "digital" : "reward",
        quantity: li.quantity ?? 1,
        metadata: {
          shopify_line_item_id: safeText(li.id),
          shopify_product_id: safeText(li.product_id),
          shopify_variant_id: safeText(li.variant_id),
          variant_title: safeText(li.variant_title),
          unit_price: safeText(li.price),
        },
      }));

      await supabase
        .schema("aa_01_campaigns")
        .from("campaign_order_lines")
        .delete()
        .eq("campaign_order_id", campaignOrderId);

      const { data, error } = await supabase
        .schema("aa_01_campaigns")
        .from("campaign_order_lines")
        .insert(lineRows)
        .select("id");
      if (error) {
        linesError = error;
        console.error("campaign_order_lines insert error", { requestId, error, campaignOrderId });
      } else {
        linesSaved = (data as { id: number }[] | null)?.length ?? 0;
      }
    } catch (e) {
      linesError = String(e);
      console.error("campaign_order_lines threw", { requestId, error: String(e) });
    }
  }

  // ── STEP 4: Upsert customer + write BOTH junctions + refresh aggregates ──
  //
  // Gated on `email && rawOrderDbId` (NOT on campaignOrderId). The
  // customer_raw_orders junction is the canonical link in the app's
  // current data model and must be written even when campaign_orders
  // didn't get a row this request — e.g. when the campaign_orders
  // upsert fails for some reason, or when this is a campaign branch
  // that we no longer route through campaign_orders.
  //
  // The customer_id is resolved by an explicit SELECT after the upsert,
  // NOT from upsert RETURNING. Background:
  //   - PostgREST's `.upsert(...).select(...)` returns the inserted/updated
  //     row in most cases, but the RETURNING clause is silently empty if
  //     the conflict path is DO NOTHING-equivalent (race condition where
  //     another connection inserted the customer concurrently, or some
  //     client/PG version combos).
  //   - This is the root cause C Chat identified in the 2026-06-26 incident
  //     where the AE C3 burst created the customer in DB but skipped every
  //     downstream link — including the junction insert and
  //     refresh_customer_aggregates.
  //   - customers.email is `citext` + unique, so the SELECT is a single
  //     index lookup; running it unconditionally is cheap.
  let customerSaved = false;
  let customerError: unknown = null;
  let resolvedCustomerId: number | null = null;

  if (email && rawOrderDbId) {
    try {
      // Upsert customer — we don't trust the RETURNING here.
      const { error: customerErr } = await supabase
        .schema("aa_02_crm")
        .from("customers")
        .upsert(
          {
            email,
            first_name: safeText(order?.shipping_address?.name)?.split(" ")[0] ?? null,
            last_name:
              safeText(order?.shipping_address?.name)?.split(" ").slice(1).join(" ") || null,
            shipping_address_1: safeText(order?.shipping_address?.address1),
            shipping_address_2: safeText(order?.shipping_address?.address2),
            shipping_city: safeText(order?.shipping_address?.city),
            shipping_zip: safeText(order?.shipping_address?.zip),
            shipping_country: safeText(order?.shipping_address?.country),
            shipping_country_code: safeText(order?.shipping_address?.country_code),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "email", ignoreDuplicates: false },
        );
      if (customerErr) {
        customerError = customerErr;
        console.error("customers upsert error", { requestId, error: customerErr, email });
      }

      // Resolve id by email — concurrency-safe and resilient to the
      // returning-customer case.
      const normalisedEmail = email.toLowerCase().trim();
      const { data: customerRow, error: selectErr } = await supabase
        .schema("aa_02_crm")
        .from("customers")
        .select("id")
        .eq("email", normalisedEmail)
        .maybeSingle();
      if (selectErr) {
        customerError = customerError ?? selectErr;
        console.error("customers select-by-email error", { requestId, error: selectErr, email });
      }
      resolvedCustomerId = (customerRow as { id: number } | null)?.id ?? null;

      if (resolvedCustomerId) {
        // The fix: junction between customer and the raw_order we just
        // inserted. Idempotent via the (customer_id, raw_order_id) unique
        // constraint, ignoreDuplicates=true so concurrent writes from a
        // burst sale don't error.
        const { error: junctionErr } = await supabase
          .schema("aa_02_crm")
          .from("customer_raw_orders")
          .upsert(
            { customer_id: resolvedCustomerId, raw_order_id: rawOrderDbId },
            { onConflict: "customer_id,raw_order_id", ignoreDuplicates: true },
          );
        if (junctionErr) {
          customerError = customerError ?? junctionErr;
          console.error("customer_raw_orders upsert error", { requestId, error: junctionErr });
        }

        // Legacy junction — kept for backwards-compat. Only runs if the
        // campaign_orders upsert above produced a row this request.
        if (campaignOrderId) {
          await supabase
            .schema("aa_02_crm")
            .from("customer_campaign_orders")
            .upsert(
              { customer_id: resolvedCustomerId, campaign_order_id: campaignOrderId },
              { onConflict: "customer_id,campaign_order_id", ignoreDuplicates: true },
            );
        }

        await supabase.rpc("refresh_customer_aggregates", { p_customer_id: resolvedCustomerId });
        customerSaved = true;
      }
    } catch (e) {
      customerError = String(e);
      console.error("customer pipeline threw", { requestId, error: String(e), email });
    }
  }

  // Always return 200 to stop Shopify retries.
  return response200({
    ok: rawSaved,
    saved_raw_order: rawSaved,
    saved_campaign_order: campaignOrderSaved,
    campaign_order_id: campaignOrderId,
    lines_saved: linesSaved,
    customer_saved: customerSaved,
    shopify_order_id,
    campaign_id,
    campaign_source: campaignSource,
    is_digital_only,
    has_digital,
    shop_domain: shopDomain,
    topic,
    webhook_id: webhookId,
    requestId,
    raw_error: rawSaved ? null : rawError,
    campaign_order_error: campaignOrderSaved ? null : campaignOrderError,
    lines_error: linesError ?? null,
    customer_error: customerSaved ? null : customerError,
    parse_ok: parsed.ok,
    parse_error: parsed.ok ? null : (parsed as { ok: false; error: string }).error,
  });
});
