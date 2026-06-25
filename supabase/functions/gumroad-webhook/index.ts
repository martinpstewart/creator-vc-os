// deno-lint-ignore-file no-explicit-any
//
// gumroad-webhook v3 — Live Gumroad Ping ingest into raw_orders.
//
// Changes from v2:
//   - STEP 4 customer pipeline now writes the canonical
//     aa_02_crm.customer_raw_orders junction (was completely absent in
//     v1/v2 — 543/543 missing in prod). Gated on `email && rawOrderDbId`,
//     not on the legacy campaign_orders pipeline. customer_id resolved
//     by explicit SELECT by email (citext + unique → single index hit),
//     NOT from upsert RETURNING — that's empty on the returning-customer
//     /concurrent-insert case and silently dropped the whole pipeline.
//
// Changes from v1:
//   - Map lookup prefers `short_product_id` (e.g. "eabzu"), then falls back to
//     `product_id` (long base64 form), then `permalink`. All 14 existing map
//     rows match on short_product_id without schema changes.
//   - Respects `can_contact` flag from Gumroad for marketing consent (sticky-
//     upwards: never demotes an existing consent=true contact).
//   - shipping_country (text) gets the country name; shipping_country_code
//     stays null because Gumroad ping doesn't supply ISO 2-char codes.
//   - Captures license_key, purchaser_id, gumroad_fee_cents in metadata.
//
// Auth: token in URL query string (?token=...). Gumroad doesn't sign webhooks.
// Body: application/x-www-form-urlencoded (Gumroad's Ping format).
// One Ping = one product purchase = one raw_orders row + one synthetic line.
//
// The function synthesises a Shopify-shaped payload so the existing
// v_raw_order_line_attribution view resolves the line via its SKU resolver
// path. The synthetic line's `sku` is set to the variant_legacy_code from
// aa_01_campaigns.gumroad_products_map keyed on Gumroad's short_product_id.
//
// Pipeline:
//   1. raw_orders upsert (source_platform='gumroad')
//   2. campaign_orders upsert (source='gumroad') — legacy
//   3. campaign_order_lines insert (single line per Gumroad order) — legacy
//   4. customers upsert + customer_raw_orders junction + customer_campaign_orders junction + refresh_customer_aggregates
//   5. contacts upsert + contact_sources append (source_type='gumroad_checkout_optin')
//
// Refunds/disputes: Ping fires only on sale. Reconciliation via CSV (out of scope here).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function safeText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const response200 = (body: unknown) => response(200, body);

// Parse a Gumroad ping form payload into a flat object.
// Gumroad sends nested keys like `variants[Tier]` and `url_params[source]`.
// We capture both the flat top-level scalars and the nested sub-objects.
function formToObject(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) {
    const value = typeof v === "string" ? v : null;
    const nestedMatch = k.match(/^([a-z_]+)\[(.+)\]$/i);
    if (nestedMatch) {
      const [, root, sub] = nestedMatch;
      const existing = (out[root] as Record<string, unknown>) ?? {};
      existing[sub] = value;
      out[root] = existing;
    } else {
      out[k] = value;
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return response200({ ok: true, ignored: true, reason: "method_not_allowed" });
  }

  // ── Auth: URL token (Gumroad has no HMAC signing) ─────────────────────────
  const url = new URL(req.url);
  const providedToken = url.searchParams.get("token");
  const expectedToken = Deno.env.get("GUMROAD_WEBHOOK_TOKEN");

  if (!expectedToken) {
    console.error("[gumroad-webhook] GUMROAD_WEBHOOK_TOKEN env var missing");
    return response(500, { ok: false, error: "server_not_configured" });
  }
  if (providedToken !== expectedToken) {
    console.warn("[gumroad-webhook] token mismatch", {
      ip: req.headers.get("x-forwarded-for"),
    });
    return response(403, { ok: false, error: "forbidden" });
  }

  const requestId =
    req.headers.get("x-sb-request-id") ?? req.headers.get("x-request-id") ?? null;

  // ── Parse form body ────────────────────────────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    console.error("[gumroad-webhook] form parse failed", { requestId, error: String(e) });
    return response200({ ok: false, error: "form_parse_failed", requestId });
  }
  const ping = formToObject(form);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase env vars", { requestId });
    return response200({ ok: false, error: "Missing env vars", requestId });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── Extract canonical Gumroad fields ──────────────────────────────────────
  const sale_id = safeText(ping.sale_id);
  const order_number = safeText(ping.order_number);
  // Gumroad sends THREE product identifiers in every ping:
  //   short_product_id  - the legacy short code (e.g. "eabzu") matching our map
  //   product_id        - the new long-form base64 UUID
  //   permalink         - the URL slug (e.g. "ISOT")
  // We map on short_product_id (matches gumroad_products_map) and fall back to
  // product_id then permalink for resilience if Gumroad's schema shifts again.
  const gumroad_short_product_id = safeText(ping.short_product_id);
  const gumroad_product_id = safeText(ping.product_id);
  const gumroad_permalink = safeText(ping.permalink);
  const license_key = safeText(ping.license_key);
  const purchaser_id = safeText(ping.purchaser_id);
  const gumroad_fee_cents =
    typeof ping.gumroad_fee === "string" && /^\d+$/.test(ping.gumroad_fee)
      ? parseInt(ping.gumroad_fee, 10)
      : null;
  const can_contact = String(ping.can_contact ?? "false").toLowerCase() === "true";
  const email = safeText(ping.email);
  const product_name = safeText(ping.product_name);
  // Gumroad sends price in USD cents as a stringified integer (e.g. "1799").
  // Keep as cents for campaign_orders.order_total (matches Shopify pattern).
  // Convert to a dollar string for the synthetic Shopify line item, which
  // expects price as a decimal string.
  const price_cents =
    typeof ping.price === "string" && /^\d+$/.test(ping.price)
      ? parseInt(ping.price, 10)
      : 0;
  const price_dollars_str = (price_cents / 100).toFixed(2);
  const quantity = parseInt(String(ping.quantity ?? "1"), 10) || 1;
  const currency = (safeText(ping.currency) ?? "usd").toLowerCase();
  const sale_timestamp = safeText(ping.sale_timestamp); // ISO 8601
  const full_name = safeText(ping.full_name);
  const ip_country = safeText(ping.ip_country);
  const refunded = String(ping.refunded ?? "false").toLowerCase() === "true";
  const disputed = String(ping.disputed ?? "false").toLowerCase() === "true";
  const dispute_won = String(ping.dispute_won ?? "false").toLowerCase() === "true";
  const isTest = String(ping.test ?? "false").toLowerCase() === "true";

  // Order status — Gumroad Ping fires on sale, so default to "paid" unless
  // the flags say otherwise.
  let financial_status = "paid";
  if (disputed) financial_status = dispute_won ? "paid" : "disputed";
  if (refunded) financial_status = "refunded";

  // shopify_order_id (which now holds source_order_id per Step 1's renaming
  // intent) must be unique within (source_platform, shopify_order_id). Prefer
  // sale_id (base64-ish unique string) over order_number.
  const source_order_id =
    sale_id ??
    order_number ??
    `missing_id:${requestId ?? "no_request"}:${Date.now()}`;

  // ── Resolve campaign + variant via gumroad_products_map ───────────────────
  // Try short_product_id first (matches existing map), then long-form
  // product_id, then permalink, before falling back.
  let campaign_id = 1; // fallback
  let mapped_variant_legacy_code: string | null = null;
  let mapped_product_legacy_code: string | null = null;
  let mapped = false;
  let mapped_by: string | null = null;

  const lookupCandidates = [
    { field: "short_product_id", value: gumroad_short_product_id },
    { field: "product_id", value: gumroad_product_id },
    { field: "permalink", value: gumroad_permalink },
  ].filter(c => c.value);

  for (const candidate of lookupCandidates) {
    if (mapped) break;
    try {
      const { data, error } = await supabase
        .schema("aa_01_campaigns")
        .from("gumroad_products_map")
        .select("campaign_id, product_legacy_code, variant_legacy_code")
        .eq("gumroad_product_id", candidate.value)
        .maybeSingle();
      if (error) {
        console.error("[gumroad-webhook] map lookup error", {
          requestId,
          field: candidate.field,
          value: candidate.value,
          error,
        });
      } else if (data) {
        campaign_id = data.campaign_id;
        mapped_product_legacy_code = data.product_legacy_code;
        mapped_variant_legacy_code = data.variant_legacy_code;
        mapped = true;
        mapped_by = candidate.field;
      }
    } catch (e) {
      console.error("[gumroad-webhook] map lookup threw", {
        requestId,
        field: candidate.field,
        error: String(e),
      });
    }
  }

  if (!mapped) {
    console.warn("[gumroad-webhook] unmapped gumroad product", {
      requestId,
      gumroad_short_product_id,
      gumroad_product_id,
      gumroad_permalink,
    });
  }

  // ── Build synthetic Shopify-shaped payload ────────────────────────────────
  // The attribution view reads `payload.line_items` with shopify-style fields.
  // Setting sku=variant_legacy_code engages the view's SKU resolver path.
  const syntheticLineItem = {
    id: sale_id,
    sku: mapped_variant_legacy_code, // may be null if unmapped — view will leave unresolved
    title: product_name,
    quantity,
    price: price_dollars_str,
    requires_shipping: false, // Gumroad is digital
    product_id: null,
    variant_id: null,
    variant_title: "Digital Download",
  };

  const syntheticPayload = {
    // Shopify-shaped (for the view + downstream tools)
    id: source_order_id,
    name: order_number ? `#${order_number}` : null,
    email,
    financial_status,
    currency: currency.toUpperCase(),
    created_at: sale_timestamp,
    total_price: price_dollars_str,
    customer: { email },
    line_items: [syntheticLineItem],
    // Gumroad-native raw audit (always preserved)
    gumroad_raw: ping,
    gumroad_mapped: mapped,
    gumroad_test: isTest,
  };

  const is_digital_only = true;
  const has_digital = true;

  // ── STEP 1: raw_orders upsert ───────────────────────────────────────────────
  const rawRow = {
    campaign_id,
    source_platform: "gumroad",
    shopify_order_id: source_order_id, // legacy column name; holds the source order id
    shopify_order_number: order_number,
    email,
    financial_status,
    fulfillment_status: null,
    processed_at: sale_timestamp ? new Date(sale_timestamp).toISOString() : null,
    payload: syntheticPayload,
    shop_domain: null,
    source_topic: "gumroad/sale",
    webhook_id: null,
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
      console.error("raw_orders upsert error", { requestId, error, source_order_id });
    } else {
      rawSaved = true;
      rawOrderDbId = (data as { id: number } | null)?.id ?? null;
    }
  } catch (e) {
    rawError = String(e);
    console.error("raw_orders upsert threw", { requestId, error: String(e) });
  }

  // ── STEP 2: campaign_orders upsert ─────────────────────────────────────────
  let campaignOrderSaved = false;
  let campaignOrderId: number | null = null;
  let campaignOrderError: unknown = null;

  if (email && rawSaved) {
    try {
      const campaignOrderRow = {
        campaign_id,
        source: "gumroad",
        source_order_id,
        email,
        order_status: financial_status,
        order_total: price_cents,
        order_amount_paid: financial_status === "paid" ? price_cents : 0,
        order_created_at: sale_timestamp ? new Date(sale_timestamp).toISOString() : null,
        shipping_name: full_name,
        shipping_address_1: null,
        shipping_address_2: null,
        shipping_city: null,
        shipping_zip: null,
        shipping_country: ip_country,
        shipping_country_code: null, // Gumroad ping does not provide ISO 2-char code
        metadata: {
          gumroad_short_product_id,
          gumroad_product_id,
          gumroad_permalink,
          gumroad_order_number: order_number,
          gumroad_test: isTest,
          gumroad_fee_cents,
          license_key,
          purchaser_id,
          can_contact,
          mapped,
          mapped_by,
          mapped_variant_legacy_code,
          mapped_product_legacy_code,
          raw_order_id: rawOrderDbId,
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
        console.error("campaign_orders upsert error", { requestId, error, source_order_id });
      } else {
        campaignOrderSaved = true;
        campaignOrderId = (data as { id: number } | null)?.id ?? null;
      }
    } catch (e) {
      campaignOrderError = String(e);
      console.error("campaign_orders upsert threw", { requestId, error: String(e) });
    }
  }

  // ── STEP 3: campaign_order_lines insert (one line per Gumroad order) ──────
  let linesSaved = 0;
  let linesError: unknown = null;

  if (campaignOrderId) {
    try {
      const lineRow = {
        campaign_order_id: campaignOrderId,
        campaign_id,
        product_name,
        product_sku: mapped_variant_legacy_code,
        product_bundle: null,
        product_line: "digital",
        quantity,
        metadata: {
          gumroad_short_product_id,
          gumroad_product_id,
          unit_price: price_dollars_str,
          variant_title: "Digital Download",
          mapped,
          mapped_by,
        },
      };

      await supabase
        .schema("aa_01_campaigns")
        .from("campaign_order_lines")
        .delete()
        .eq("campaign_order_id", campaignOrderId);

      const { data, error } = await supabase
        .schema("aa_01_campaigns")
        .from("campaign_order_lines")
        .insert([lineRow])
        .select("id");
      if (error) {
        linesError = error;
        console.error("campaign_order_lines insert error", { requestId, error });
      } else {
        linesSaved = (data as { id: number }[] | null)?.length ?? 0;
      }
    } catch (e) {
      linesError = String(e);
      console.error("campaign_order_lines threw", { requestId, error: String(e) });
    }
  }

  // ── STEP 4: customer upsert + write BOTH junctions + refresh aggregates ──
  //
  // v3 fix: previously gated on `email && campaignOrderId`, and never
  // wrote the canonical aa_02_crm.customer_raw_orders junction at all
  // (100% missing in prod — 543/543 orders). Now:
  //   - Gated on `email && rawOrderDbId` so the junction is written
  //     even when campaign_orders happens to be unhappy or skipped.
  //   - customer_id is resolved by explicit SELECT after the upsert,
  //     not from upsert RETURNING — that's empty on the
  //     returning-customer / concurrent-insert case and silently dropped
  //     the whole pipeline.
  //   - Writes customer_raw_orders (the canonical link), then the
  //     legacy customer_campaign_orders if campaignOrderId is set.
  let customerSaved = false;
  let customerError: unknown = null;
  let customerId: number | null = null;

  if (email && rawOrderDbId) {
    try {
      const firstName = full_name?.split(" ")[0] ?? null;
      const lastName = full_name?.split(" ").slice(1).join(" ") || null;

      const { error: customerErr } = await supabase
        .schema("aa_02_crm")
        .from("customers")
        .upsert(
          {
            email,
            first_name: firstName,
            last_name: lastName,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "email", ignoreDuplicates: false },
        );
      if (customerErr) {
        customerError = customerErr;
        console.error("customers upsert error", { requestId, error: customerErr, email });
      }

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
      customerId = (customerRow as { id: number } | null)?.id ?? null;

      if (customerId) {
        // The fix: junction between customer and the raw_order we just
        // inserted. Idempotent + concurrency-safe.
        const { error: junctionErr } = await supabase
          .schema("aa_02_crm")
          .from("customer_raw_orders")
          .upsert(
            { customer_id: customerId, raw_order_id: rawOrderDbId },
            { onConflict: "customer_id,raw_order_id", ignoreDuplicates: true },
          );
        if (junctionErr) {
          customerError = customerError ?? junctionErr;
          console.error("customer_raw_orders upsert error", { requestId, error: junctionErr });
        }

        if (campaignOrderId) {
          await supabase
            .schema("aa_02_crm")
            .from("customer_campaign_orders")
            .upsert(
              { customer_id: customerId, campaign_order_id: campaignOrderId },
              { onConflict: "customer_id,campaign_order_id", ignoreDuplicates: true },
            );
        }

        await supabase.rpc("refresh_customer_aggregates", { p_customer_id: customerId });
        customerSaved = true;
      }
    } catch (e) {
      customerError = String(e);
      console.error("customer pipeline threw", { requestId, error: String(e), email });
    }
  }

  // ── STEP 5: contacts upsert + contact_sources append ──────────────────────
  // Gumroad has no explicit consent capture at checkout, but a paying customer
  // implicitly opts in (same logic as legacy_customer_backfill from May 15).
  // Consent rule stays sticky-upwards — never demote.
  let contactSaved = false;
  let contactId: number | null = null;
  let contactConsentPromoted = false;
  let contactError: unknown = null;

  if (email && customerId && !isTest) {
    try {
      const { data: existing, error: readErr } = await supabase
        .schema("aa_03_marketing")
        .from("contacts")
        .select("id, marketing_consent, marketing_consent_at, marketing_consent_source, customer_id")
        .eq("email", email)
        .maybeSingle();
      if (readErr) {
        contactError = readErr;
        console.error("contacts read error", { requestId, error: readErr });
      } else {
        const firstName = full_name?.split(" ")[0] ?? null;
        const lastName = full_name?.split(" ").slice(1).join(" ") || null;
        const nowIso = new Date().toISOString();

        // Consent: respect Gumroad's can_contact flag. Sticky-upwards:
        // if the contact already had consent=true, keep it true even if
        // this ping says false (never demote silently). New consent grants
        // (existing=false/null, ping=true) set marketing_consent_at to now.
        const existingConsent = existing?.marketing_consent === true;
        const consentNow = existingConsent || can_contact;
        contactConsentPromoted = !existingConsent && can_contact;

        const consentAt =
          existing?.marketing_consent_at ??
          (consentNow ? nowIso : null);
        const consentSource =
          existing?.marketing_consent_source ??
          (consentNow ? "gumroad_checkout" : null);

        const contactRow = {
          email,
          first_name: firstName,
          last_name: lastName,
          marketing_consent: consentNow,
          marketing_consent_at: consentAt,
          marketing_consent_source: consentSource,
          customer_id: existing?.customer_id ?? customerId,
          last_seen_at: nowIso,
          updated_at: nowIso,
        };

        const { data: upserted, error: upsertErr } = await supabase
          .schema("aa_03_marketing")
          .from("contacts")
          .upsert(contactRow, { onConflict: "email" })
          .select("id")
          .maybeSingle();

        if (upsertErr) {
          contactError = upsertErr;
          console.error("contacts upsert error", { requestId, error: upsertErr, email });
        } else if ((upserted as { id: number } | null)?.id) {
          contactId = (upserted as { id: number }).id;

          const { error: sourceErr } = await supabase
            .schema("aa_03_marketing")
            .from("contact_sources")
            .insert({
              contact_id: contactId,
              source_type: "gumroad_checkout_optin",
              source_raw_order_id: rawOrderDbId,
              campaign_id,
              metadata: {
                gumroad_short_product_id,
                gumroad_product_id,
                gumroad_permalink,
                gumroad_order_number: order_number,
                can_contact,
                consent_promoted: contactConsentPromoted,
                mapped,
                mapped_by,
              },
            });
          if (sourceErr) {
            contactError = sourceErr;
            console.error("contact_sources insert error", { requestId, error: sourceErr });
          } else {
            contactSaved = true;
          }
        }
      }
    } catch (e) {
      contactError = String(e);
      console.error("contact pipeline threw", { requestId, error: String(e), email });
    }
  }

  return response200({
    ok: rawSaved,
    saved_raw_order: rawSaved,
    saved_campaign_order: campaignOrderSaved,
    campaign_order_id: campaignOrderId,
    lines_saved: linesSaved,
    customer_saved: customerSaved,
    contact_saved: contactSaved,
    contact_id: contactId,
    contact_consent_promoted: contactConsentPromoted,
    raw_order_id: rawOrderDbId,
    source_order_id,
    campaign_id,
    mapped,
    mapped_by,
    mapped_variant_legacy_code,
    mapped_product_legacy_code,
    gumroad_short_product_id,
    gumroad_product_id,
    gumroad_permalink,
    can_contact,
    is_test: isTest,
    requestId,
    raw_error: rawSaved ? null : rawError,
    campaign_order_error: campaignOrderSaved ? null : campaignOrderError,
    lines_error: linesError ?? null,
    customer_error: customerSaved ? null : customerError,
    contact_error: contactSaved ? null : contactError,
  });
});
