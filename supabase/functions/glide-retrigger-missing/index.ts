// glide-retrigger-missing — POSTs each currently-red dispatch alert
// to Glide's dispatch webhook so Glide can re-attempt the Acutrack
// hand-off. Called by the AcutrackImportForm right after a successful
// acutrack_import_commit; Acutrack itself has no API, but Glide's
// existing dispatch workflow forwards to Acutrack on our behalf, so
// kicking Glide is the only programmatic route we have.
//
// Auth:
//   - verify_jwt = true (Supabase enforces a valid JWT before the
//     function body runs).
//   - The Postgres RPCs (get_dispatch_orders_to_retrigger,
//     log_payhere_retrigger) are SECURITY DEFINER but check
//     public.is_owner() — i.e. martinpstewart@gmail.com only. A
//     non-owner JWT will receive 42501 from the first RPC and the
//     function will surface that to the caller.
//
// Idempotency:
//   - get_dispatch_orders_to_retrigger excludes any payhere_id with
//     a successful retrigger in the last 24h, so rapid CSV re-uploads
//     don't spam Glide for the same set.
//
// Glide webhook auth:
//   - The URL is the secret. Set GLIDE_WEBHOOK_URL in Supabase
//     secrets. If it's not set, the function 200s with a clear
//     "not configured" message so the import flow doesn't fail.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const GLIDE_WEBHOOK_URL = Deno.env.get("GLIDE_WEBHOOK_URL") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

type DispatchOrder = {
  payhere_id: number;
  order_id: string | null;
  email: string;
  amount: number | string;
  currency: string;
  paid_at: string;
  reason: string;
  status?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  // Helper to call PostgREST RPCs with the caller's JWT so the
  // SECURITY DEFINER auth.uid() check resolves correctly.
  async function rpc(name: string, body: Record<string, unknown> = {}): Promise<Response> {
    return await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
        "Authorization": auth,
      },
      body: JSON.stringify(body),
    });
  }

  // 1. Get the list of orders to retrigger (red flagged AND not
  // already successfully retriggered in the last 24h).
  let orders: DispatchOrder[];
  try {
    const r = await rpc("get_dispatch_orders_to_retrigger");
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return json({ error: `eligibility: ${txt.slice(0, 300)}` }, r.status);
    }
    const payload = await r.json() as { orders?: DispatchOrder[] };
    orders = payload.orders ?? [];
  } catch (e) {
    return json({ error: `eligibility fetch failed: ${String(e).slice(0, 200)}` }, 502);
  }

  // 2. If Glide isn't configured, surface that cleanly. We don't want
  // the import flow to fail just because the URL isn't set yet.
  if (!GLIDE_WEBHOOK_URL) {
    return json({
      retriggered: 0,
      skipped: 0,
      failures: 0,
      eligible: orders.length,
      configured: false,
      message:
        "GLIDE_WEBHOOK_URL is not set in Supabase secrets — retriggers were skipped. Set it via Supabase dashboard → Edge Functions → Secrets.",
    });
  }

  // 3. POST each eligible order to Glide. Single request per order so
  // a partial failure leaves the others intact. Log every attempt via
  // log_payhere_retrigger so the audit trail lives in Postgres.
  let retriggered = 0;
  let failures = 0;
  const errors: Array<{ payhere_id: number; status: number; error: string }> = [];

  for (const o of orders) {
    let status = 0;
    let success = false;
    let errText: string | null = null;
    try {
      const r = await fetch(GLIDE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payhere_id: o.payhere_id,
          order_id:   o.order_id,
          email:      o.email,
          amount:     o.amount,
          currency:   o.currency,
          paid_at:    o.paid_at,
        }),
      });
      status = r.status;
      success = r.ok;
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        errText = txt.slice(0, 500);
      }
    } catch (e) {
      success = false;
      errText = String(e).slice(0, 500);
    }

    // Best-effort log. If logging fails, continue — we already did
    // the POST.
    try {
      await rpc("log_payhere_retrigger", {
        p_payhere_id:  o.payhere_id,
        p_success:     success,
        p_http_status: status || null,
        p_error_text:  success ? null : errText,
      });
    } catch (_e) { /* swallow */ }

    if (success) {
      retriggered += 1;
    } else {
      failures += 1;
      errors.push({ payhere_id: o.payhere_id, status, error: errText ?? "unknown error" });
    }
  }

  return json({
    retriggered,
    failures,
    skipped: 0,
    eligible: orders.length,
    configured: true,
    errors: errors.slice(0, 10),
  });
});
