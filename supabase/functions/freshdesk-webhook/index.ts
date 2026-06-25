// freshdesk-webhook — ACK-FIRST routing through public.freshdesk_ingest RPC
// (aa_04_support stays unexposed).
//
// v15 (ack-first): the webhook now returns 200 to Freshdesk IMMEDIATELY,
// before touching the database. The raw-payload capture and the
// freshdesk_ingest RPC are moved into a background task via
// EdgeRuntime.waitUntil(), so Freshdesk never waits on Postgres and can
// no longer 504 us when the DB is under load. The request body is read
// inline (the stream must be consumed before we respond); all parsing +
// DB work happens after the response is sent. Any background failure is
// logged and swallowed — Freshdesk has already been acked.
//
// Parsing logic (sanitizeJson / regexExtract / unescapeJsonString) is
// unchanged from v9: JSON.parse + sanitizeJson both fail in practice for
// Freshdesk's payloads, so the regex fallback is the hot path and
// captures description too.
//
// verify_jwt = false (set in function config, not here).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const nz = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
const rpcHeaders = () => ({
  "Content-Type": "application/json", "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`,
});

function sanitizeJson(s: string): string {
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i], code = s.charCodeAt(i);
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === '"') { out += ch; inStr = false; continue; }
      if (code < 0x20) {
        out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t"
             : "\\u" + code.toString(16).padStart(4, "0");
        continue;
      }
      out += ch;
    } else { out += ch; if (ch === '"') inStr = true; }
  }
  return out;
}

// Decode the common JSON escape sequences regexExtract leaves behind
// (it just strips the wrapping quotes). Without this pass, descriptions
// render with literal `\n` / `\"` instead of newlines / quotes.
function unescapeJsonString(s: string): string {
  return s
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    // \uXXXX → char. Run before \\ → \ so the order doesn't matter.
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\\/g, "\\");
}

function regexExtract(raw: string): Record<string, unknown> {
  // The regex matches the value of a top-level string field:
  //   `"key" : "..."`  where the body permits any non-quote / non-
  //   backslash character OR an escape sequence. Works for HTML-laden
  //   descriptions because their internal quotes / newlines arrive
  //   already JSON-escaped.
  const get = (k: string) => {
    const m = raw.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    return m ? unescapeJsonString(m[1]) : "";
  };
  return {
    ticket_id: get("ticket_id"), subject: get("subject"), status: get("status"),
    priority: get("priority"), source: get("source"), group: get("group"), agent: get("agent"),
    requester_email: get("requester_email"), requester_name: get("requester_name"),
    company: get("company"), created_at: get("created_at"), updated_at: get("updated_at"),
    film: get("film"), order_number: get("order_number"),
    description: get("description"),
  };
}

// All database work happens here, AFTER the 200 has gone back to
// Freshdesk. Errors are logged and swallowed — the ack is already sent,
// so a failure here never produces a 504 on Freshdesk's side.
async function processInBackground(
  rawBody: string,
  receivedAt: string,
  method: string,
  contentType: string | null,
): Promise<void> {
  let body: Record<string, unknown> | null = null;
  if (rawBody) {
    try { body = JSON.parse(rawBody); }
    catch (_e) {
      try { body = JSON.parse(sanitizeJson(rawBody)); }
      catch (_e2) { body = regexExtract(rawBody); }
    }
  }

  // Capture raw payload (transitional scratch table). Now off the
  // critical path — safe to retire whenever the transition is done.
  try {
    await fetch(`${SB_URL}/rest/v1/_freshdesk_capture`, {
      method: "POST",
      headers: { ...rpcHeaders(), "Prefer": "return=minimal" },
      body: JSON.stringify({
        received_at: receivedAt, method,
        content_type: contentType,
        headers: {}, raw_body: rawBody, parsed_body: body,
      }),
    });
  } catch (_e) { /* never fail on capture */ }

  // Normalise to the ingest shape and hand off.
  const ticketId = body?.["ticket_id"] != null ? parseInt(String(body["ticket_id"]), 10) : NaN;
  if (body && Number.isFinite(ticketId)) {
    try {
      const norm = [{
        freshdesk_ticket_id: ticketId,
        ticket_number: String(ticketId),
        subject: nz(body["subject"]),
        description: nz(body["description"]),
        status: nz(body["status"]),
        priority: nz(body["priority"]),
        source: nz(body["source"]),
        group_name: nz(body["group"]),
        agent_name: nz(body["agent"]),
        requester_email: nz(body["requester_email"])?.toLowerCase() ?? null,
        requester_name: nz(body["requester_name"]),
        order_ref: nz(body["order_number"]),
        film_raw: nz(body["film"]),
        created_at: nz(body["created_at"]),
        last_actioned_at: nz(body["updated_at"]) ?? nz(body["created_at"]),
      }];
      const rpc = await fetch(`${SB_URL}/rest/v1/rpc/freshdesk_ingest`, {
        method: "POST", headers: rpcHeaders(),
        body: JSON.stringify({ p_tickets: norm, p_log_unchanged: true }),
      });
      if (!rpc.ok) console.log("freshdesk-webhook: ingest failed", rpc.status, await rpc.text());
    } catch (e) { console.log("freshdesk-webhook: exception", String(e)); }
  }
}

Deno.serve(async (req: Request) => {
  const receivedAt = new Date().toISOString();
  const method = req.method;
  const contentType = req.headers.get("content-type");

  // The request stream must be consumed before we respond, so read the
  // body inline. Everything after this — parse + capture + ingest — is
  // deferred so Freshdesk gets its 200 without waiting on Postgres.
  let rawBody = "";
  try { rawBody = await req.text(); }
  catch (e) { console.log("freshdesk-webhook: read fail", String(e)); }

  EdgeRuntime.waitUntil(processInBackground(rawBody, receivedAt, method, contentType));

  return new Response(JSON.stringify({ ok: true, received_at: receivedAt }),
    { status: 200, headers: { "Content-Type": "application/json", "Connection": "keep-alive" } });
});
