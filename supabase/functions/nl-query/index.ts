// Natural-language query Edge Function for Creator VC OS.
//
// Flow per request:
//   1. Auth: verify the caller is a logged-in Supabase user.
//   2. Tier 1: try template matching via Claude Haiku.
//   3. Tier 2: if no high/medium-confidence match, generate SQL with
//      Claude Sonnet using the schema context.
//   4. Validate the SQL (regex check) — single SELECT/WITH only.
//   5. Execute as nl_query_reader (read-only role with 30s timeout
//      enforced at the DB level).
//   6. Cap rows; for export mode (?export=csv), bypass cap to 500k.
//   7. Log every attempt to public.nl_query_log via service role.

// deno-lint-ignore-file no-explicit-any
import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { templates, templateByName } from './templates.ts'
import { matchTemplate, generateSql } from './anthropic.ts'
import { validateSql } from './validate.ts'
import type { QueryResponse } from './types.ts'

const VIEWER_ROW_CAP = 50_000
const EXPORT_ROW_CAP = 500_000

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const NL_READER_DB_URL = Deno.env.get('NL_READER_DB_URL')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

// Long-lived service-role client for auth verification + log writes.
// (Only the read query goes through the limited-role connection.)
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  })
}

async function logQuery(entry: {
  user_id: string | null
  user_email: string | null
  question: string
  query_type: 'template' | 'generated'
  template_name: string | null
  sql_executed: string | null
  row_count: number | null
  duration_ms: number | null
  success: boolean
  error_message: string | null
}) {
  try {
    await admin.from('nl_query_log').insert(entry)
  } catch (e) {
    // Logging failures must not break the user request.
    console.error('[nl-query] log insert failed', e)
  }
}

function rowsToCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [columns.join(',')]
  for (const r of rows) lines.push(columns.map((c) => escape(r[c])).join(','))
  return lines.join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  // Templates listing endpoint — auth-required, but cheap.
  const url = new URL(req.url)
  if (url.searchParams.get('list_templates') === 'true') {
    return jsonResponse({
      templates: templates.map((t) => ({
        name: t.name,
        description: t.description,
        example_questions: t.example_questions,
        params: t.params.map((p) => ({
          name: p.name,
          type: p.type,
          required: p.required,
          default: p.default,
        })),
      })),
    })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405)
  }

  // 1. Auth
  const authHeader = req.headers.get('authorization') ?? ''
  const accessToken = authHeader.replace(/^Bearer\s+/i, '')
  if (!accessToken) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }
  const { data: { user }, error: authError } = await admin.auth.getUser(accessToken)
  if (authError || !user) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  // 2. Body
  let body: { question?: string; export?: 'csv' } = {}
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid JSON body' }, 400)
  }
  const question = (body.question ?? '').trim()
  if (!question) {
    return jsonResponse({ error: 'question is required' }, 400)
  }
  const isExport = body.export === 'csv' || url.searchParams.get('export') === 'csv'
  const rowCap = isExport ? EXPORT_ROW_CAP : VIEWER_ROW_CAP

  const started = Date.now()
  let queryType: 'template' | 'generated' = 'generated'
  let templateName: string | null = null
  let executedSql: string | null = null

  try {
    // 3. Tier 1: template match
    const match = await matchTemplate({ apiKey: ANTHROPIC_API_KEY, question })
    let sqlText: string
    let positionalParams: unknown[] = []

    if (match.match && (match.confidence === 'high' || match.confidence === 'medium')) {
      const tpl = templateByName[match.template_name]
      if (!tpl) {
        // Defensive — matchTemplate already filters but stay safe.
        throw new Error(`unknown template ${match.template_name}`)
      }
      queryType = 'template'
      templateName = tpl.name
      sqlText = tpl.sql(match.params)
      positionalParams = tpl.build_params(match.params)
    } else {
      // 4. Tier 2: generate
      sqlText = await generateSql({ apiKey: ANTHROPIC_API_KEY, question })
    }

    // 5. Validate (regex check; the role enforces the real read-only contract)
    const validation = validateSql(sqlText)
    if (!validation.ok) {
      executedSql = sqlText
      const duration = Date.now() - started
      await logQuery({
        user_id: user.id,
        user_email: user.email ?? null,
        question,
        query_type: queryType,
        template_name: templateName,
        sql_executed: sqlText,
        row_count: null,
        duration_ms: duration,
        success: false,
        error_message: `validation: ${validation.reason}`,
      })
      return jsonResponse({ error: `query rejected: ${validation.reason}`, sql: sqlText }, 400)
    }
    executedSql = validation.sql

    // 6. Execute as nl_query_reader. postgresjs auto-parameterises with
    //    .unsafe() — we use it because templates were built with $1/$2/…
    //    placeholders. The destination role still has SELECT-only grants.
    const sql = postgres(NL_READER_DB_URL, {
      max: 1,
      idle_timeout: 5,
      connection: { application_name: 'nl-query' },
    })
    let rows: Record<string, unknown>[] = []
    let columns: string[] = []
    try {
      const result = await sql.unsafe(executedSql, positionalParams as any[])
      rows = (result as Record<string, unknown>[]).slice(0, rowCap)
      columns = (result as any).columns?.map((c: any) => c.name) ?? (rows[0] ? Object.keys(rows[0]) : [])
    } finally {
      await sql.end({ timeout: 1 })
    }

    const duration = Date.now() - started
    const truncated = rows.length === rowCap // best-effort flag

    // 7. Log success
    await logQuery({
      user_id: user.id,
      user_email: user.email ?? null,
      question,
      query_type: queryType,
      template_name: templateName,
      sql_executed: executedSql,
      row_count: rows.length,
      duration_ms: duration,
      success: true,
      error_message: null,
    })

    if (isExport) {
      const csv = rowsToCsv(rows, columns)
      return new Response(csv, {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="nl-query-${Date.now()}.csv"`,
          ...CORS_HEADERS,
        },
      })
    }

    const response: QueryResponse = {
      rows,
      columns,
      sql: executedSql,
      query_type: queryType,
      template_name: templateName ?? undefined,
      truncated,
      row_count: rows.length,
      duration_ms: duration,
    }
    return jsonResponse(response)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const duration = Date.now() - started
    await logQuery({
      user_id: user.id,
      user_email: user.email ?? null,
      question,
      query_type: queryType,
      template_name: templateName,
      sql_executed: executedSql,
      row_count: null,
      duration_ms: duration,
      success: false,
      error_message: message.slice(0, 2000),
    })
    return jsonResponse({ error: message }, 500)
  }
})
