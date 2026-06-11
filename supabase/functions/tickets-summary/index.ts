// tickets-summary — Claude-backed narrative summary of a tickets window.
//
// Called from the /tickets page when a staff member clicks "Generate
// summary" on a date-range filter. We:
//   1. Validate the caller has a Supabase JWT (verify_jwt = true on
//      the function config, so Supabase has already done this).
//   2. Forward that JWT to the SECURITY DEFINER RPC get_tickets_summary_stats,
//      which RAISEs if the caller isn't staff (current_app_role IS NULL).
//   3. Hand the precomputed stats + a 30-row description sample to
//      Claude Sonnet for the narrative paragraph.
//   4. Return { paragraph, themes, top_subjects, total_tickets, from, to }.
//
// Reuses the ANTHROPIC_API_KEY Supabase secret already wired for
// nl-query. Same model selection rationale: Sonnet for prose,
// summary quality matters more than cost.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

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

// Prompt: explicit no-PII instruction, single-paragraph output.
const SYSTEM_PROMPT = `You are a customer-support analyst writing an executive summary of a tickets dataset for a stakeholder update.

OUTPUT RULES (strict):
- Output ONLY a single paragraph of plain prose, 4 to 8 sentences. No bullet points, no headings, no preamble.
- DO NOT name any individual customer, staff member, real email address, real order number, or ticket ID.
- Cite rough percentages from the theme counts rather than raw numbers ("around a quarter…", "roughly 40%…").
- Use the sample subject lines and excerpts to ADD TEXTURE (paraphrase what kinds of things people say), but never quote them verbatim.
- Tone: dry, factual, mild humour acceptable. Think Bloomberg market commentary, not marketing copy.
- Identify the gravity well of the inbox — what theme dominates, what's the long tail, are there any anomalies in the sample.`.trim();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Supabase's verify_jwt has already validated this header; we just
  // need to forward it through to PostgREST so auth.uid() resolves
  // inside the SECURITY DEFINER RPC.
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  let body: { from?: string; to?: string };
  try { body = await req.json(); }
  catch { return json({ error: "invalid JSON body" }, 400); }

  if (!body.from || !body.to) {
    return json({ error: "from and to are required ISO timestamp strings" }, 400);
  }

  // Step 1: precomputed stats from Postgres.
  let stats: Record<string, unknown>;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/get_tickets_summary_stats`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
        "Authorization": auth,
      },
      body: JSON.stringify({ p_from: body.from, p_to: body.to }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      // Forward 401/403 cleanly, otherwise wrap as 502.
      return json({ error: `stats: ${txt.slice(0, 300)}` }, r.status === 401 || r.status === 403 ? r.status : 502);
    }
    stats = await r.json() as Record<string, unknown>;
  } catch (e) {
    return json({ error: `stats fetch failed: ${String(e).slice(0, 200)}` }, 502);
  }

  const totalTickets = Number(stats.total_tickets ?? 0);

  // Short-circuit empty windows — no point burning LLM tokens.
  if (totalTickets === 0) {
    return json({
      total_tickets: 0,
      from: stats.from, to: stats.to,
      themes: stats.themes ?? {},
      top_subjects: stats.top_subjects ?? [],
      paragraph: "No tickets received in this window.",
    });
  }

  // Step 2: ask Claude for the narrative paragraph.
  const userPrompt = `Date range: ${body.from} to ${body.to}
Total tickets in window: ${totalTickets}

Theme counts (each row is "category: count of tickets that mentioned that category"):
${JSON.stringify(stats.themes, null, 2)}

Top recurring subject lines:
${JSON.stringify(stats.top_subjects, null, 2)}

Sample of ticket bodies (excerpts of what customers wrote — anonymise everything):
${JSON.stringify(stats.sample_descriptions, null, 2)}

Write the single-paragraph executive summary now.`;

  let paragraph = "";
  try {
    const r = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": ANTHROPIC_KEY,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return json({ error: `LLM ${r.status}: ${txt.slice(0, 300)}` }, 502);
    }
    const claudeData = await r.json() as { content?: Array<{ type: string; text?: string }> };
    paragraph = (claudeData.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();
  } catch (e) {
    return json({ error: `LLM fetch failed: ${String(e).slice(0, 200)}` }, 502);
  }

  return json({
    total_tickets: totalTickets,
    from: stats.from,
    to: stats.to,
    themes: stats.themes ?? {},
    top_subjects: stats.top_subjects ?? [],
    paragraph,
  });
});
