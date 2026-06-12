// payhere-poll
// Hourly reconciliation poll against the Payhere REST API.
// Reads GET /api/v1/payments (newest-first), walks until it crosses the stored
// watermark, fetches each NEW payment's detail to capture custom_fields.order_ID,
// and upserts into aa_01_campaigns.payhere_payments.
//
// First run (watermark NULL) only SEEDS the watermark to the current max payment
// id and exits — it does NOT backfill history (that would exceed the function
// time limit and stampede the API). Going-forward runs handle only the delta.
//
// v3 (2026-06-12) — fix for the order_id casing bug.
// Payhere keys custom_fields by the LABEL configured on the plan form. The
// CreatorVC shipping-payment plan was set up with the label "order_ID"
// (capital ID), so payments arrive as { custom_fields: { order_ID: "#69103" } }.
// The prior code read `custom_fields.order_id` (lowercase) and missed every
// single one — rows landed with order_id = null and showed up as
// `unlinkable_no_order_id` in the dispatch monitor even though the PO number
// was right there in the payload. Read both case variants now for safety.
//
// Secrets / env:
//   payhere_secret              -> Payhere API key (set in Supabase Edge Function secrets)
//   SUPABASE_URL                -> auto-injected
//   SUPABASE_SERVICE_ROLE_KEY   -> auto-injected

import { createClient } from "jsr:@supabase/supabase-js@2";

const PAYHERE_BASE = "https://api.payhere.co/api/v1";
const PER_PAGE = 100;
const MAX_PAGES_PER_RUN = 50;   // safety cap against runaway paging
const DETAIL_DELAY_MS = 60;     // small gap between detail fetches (anti-stampede)

const SCHEMA = "aa_01_campaigns";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const PAYHERE_KEY = Deno.env.get("payhere_secret")!;

function payhereHeaders() {
  return {
    "Accept": "application/json",
    "Authorization": `Bearer ${PAYHERE_KEY}`,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getPaymentsPage(page: number) {
  const url = `${PAYHERE_BASE}/payments?page=${page}&per_page=${PER_PAGE}`;
  const res = await fetch(url, { headers: payhereHeaders() });
  if (!res.ok) {
    throw new Error(`list payments page ${page} -> HTTP ${res.status}: ${await res.text()}`);
  }
  return await res.json(); // { data: [...], meta: { next_page, ... } }
}

async function getPaymentDetail(id: number) {
  const url = `${PAYHERE_BASE}/payments/${id}`;
  const res = await fetch(url, { headers: payhereHeaders() });
  if (!res.ok) {
    // Don't fail the whole run for one bad detail fetch — log and skip detail.
    console.error(`detail ${id} -> HTTP ${res.status}: ${await res.text()}`);
    return null;
  }
  const body = await res.json();
  return body?.data ?? null;
}

// Extract the order id from a Payhere payment. Payhere keys
// custom_fields by the LABEL string from the plan's form definition.
// The CreatorVC shipping plan uses "order_ID" (capital ID), but a
// defensive fallback to "order_id" covers any plan that was set up
// the other way. Trims whitespace and treats empty as null.
function pickOrderId(detail: unknown, listRow: unknown): string | null {
  // deno-lint-ignore no-explicit-any
  const d: any = detail ?? listRow;
  // deno-lint-ignore no-explicit-any
  const l: any = listRow;
  const candidate =
    (typeof d?.custom_fields?.order_ID === "string" ? d.custom_fields.order_ID : null) ??
    (typeof d?.custom_fields?.order_id === "string" ? d.custom_fields.order_id : null) ??
    (typeof l?.custom_fields?.order_ID === "string" ? l.custom_fields.order_ID : null) ??
    (typeof l?.custom_fields?.order_id === "string" ? l.custom_fields.order_id : null) ??
    null;
  if (!candidate) return null;
  const trimmed = String(candidate).trim();
  return trimmed === "" ? null : trimmed;
}

// Map a Payhere payment (list row + optional detail) into our row shape.
// deno-lint-ignore no-explicit-any
function toRow(listRow: any, detail: any | null) {
  const d = detail ?? listRow;
  return {
    payhere_id: listRow.id,
    hashid: listRow.hashid ?? d?.hashid ?? null,
    order_id: pickOrderId(detail, listRow),
    customer_email: d?.customer?.email ?? null,
    amount: listRow.amount ?? d?.amount ?? null,
    amount_paid: listRow.amount_paid ?? d?.amount_paid ?? null,
    refund_amount: listRow.refund_amount ?? d?.refund_amount ?? null,
    currency: listRow.currency ?? d?.currency ?? null,
    status: listRow.status ?? d?.status ?? null,
    success: listRow.success ?? d?.success ?? null,
    object_name: listRow.object_name ?? d?.object_name ?? null,
    payhere_created_at: listRow.created_at ?? d?.created_at ?? null,
    payhere_updated_at: listRow.updated_at ?? d?.updated_at ?? null,
    raw: d ?? listRow,
    last_polled_at: new Date().toISOString(),
  };
}

async function readWatermark(): Promise<number | null> {
  const { data, error } = await supabase
    .schema(SCHEMA)
    .from("payhere_poll_state")
    .select("last_seen_payhere_id")
    .eq("id", 1)
    .single();
  if (error) throw new Error(`read watermark: ${error.message}`);
  return data?.last_seen_payhere_id ?? null;
}

async function setWatermark(maxId: number | null, count: number, status: string) {
  const { error } = await supabase
    .schema(SCHEMA)
    .from("payhere_poll_state")
    .update({
      last_seen_payhere_id: maxId,
      last_polled_at: new Date().toISOString(),
      last_run_count: count,
      last_run_status: status,
    })
    .eq("id", 1);
  if (error) throw new Error(`set watermark: ${error.message}`);
}

Deno.serve(async (_req) => {
  try {
    const watermark = await readWatermark();

    // ---- FIRST RUN: seed watermark only, no backfill ----
    if (watermark === null) {
      const first = await getPaymentsPage(1);
      const rows = first?.data ?? [];
      // deno-lint-ignore no-explicit-any
      const maxId = rows.length ? Math.max(...rows.map((r: any) => r.id)) : null;
      await setWatermark(maxId, 0, "seeded");
      return new Response(
        JSON.stringify({ ok: true, mode: "seed", seeded_watermark: maxId }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // ---- DELTA RUN: collect everything with id > watermark ----
    // deno-lint-ignore no-explicit-any
    const newRows: any[] = [];
    let page = 1;
    let crossed = false;

    while (page <= MAX_PAGES_PER_RUN && !crossed) {
      const body = await getPaymentsPage(page);
      // deno-lint-ignore no-explicit-any
      const rows: any[] = body?.data ?? [];
      for (const r of rows) {
        if (r.id <= watermark) { crossed = true; break; }
        newRows.push(r);
      }
      const next = body?.meta?.next_page;
      if (crossed || !next) break;
      page = next;
    }

    // Fetch detail (for custom_fields.order_ID) sequentially, then upsert.
    // deno-lint-ignore no-explicit-any
    const upserts: any[] = [];
    for (const listRow of newRows) {
      const detail = await getPaymentDetail(listRow.id);
      upserts.push(toRow(listRow, detail));
      await sleep(DETAIL_DELAY_MS);
    }

    if (upserts.length) {
      const { error } = await supabase
        .schema(SCHEMA)
        .from("payhere_payments")
        .upsert(upserts, { onConflict: "payhere_id" });
      if (error) throw new Error(`upsert payments: ${error.message}`);
    }

    const maxId = newRows.length
      // deno-lint-ignore no-explicit-any
      ? Math.max(...newRows.map((r: any) => r.id))
      : watermark;
    await setWatermark(maxId, upserts.length, "ok");

    return new Response(
      JSON.stringify({
        ok: true,
        mode: "delta",
        new_payments: upserts.length,
        new_watermark: maxId,
        pages_scanned: page,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    // record the failure WITHOUT touching last_seen_payhere_id (no silent reset)
    try {
      await supabase.schema(SCHEMA).from("payhere_poll_state")
        .update({
          last_polled_at: new Date().toISOString(),
          last_run_count: -1,
          last_run_status: `error: ${String(e).slice(0, 200)}`,
        })
        .eq("id", 1);
    } catch (_) { /* swallow */ }
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
