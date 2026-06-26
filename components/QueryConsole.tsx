'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import QueryResultsTable from './QueryResultsTable'
import TemplateBrowser from './TemplateBrowser'
import RecentQueries from './RecentQueries'

type QueryResponse = {
  rows: Record<string, unknown>[]
  columns: string[]
  sql: string
  query_type: 'template' | 'generated'
  template_name?: string
  truncated: boolean
  row_count: number
  duration_ms: number
}

// Shape carried alongside the result when the user is viewing a past
// run (tapped a Recent Queries item). Lets the UI render a "Showing
// previous run from {timeAgo}" banner and a Re-run button, without
// re-invoking the AI / DB query.
type PastRunInfo = {
  ranAt: string
  isPartial: boolean   // true when result_truncated on the log row
}

const FUNCTION_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/nl-query`
const RECIPIENTS_STORAGE_KEY = 'creatorvc.email.recipients'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

export default function QueryConsole() {
  const router = useRouter()
  const [question, setQuestion] = useState('')
  // Captures the question that produced the current `result`. We
  // clear the textbox on a successful submit (UX request from Robin)
  // but the CSV/email actions still need to know the question they're
  // exporting for, so we stash it here separately.
  const [submittedQuestion, setSubmittedQuestion] = useState('')
  const [running, setRunning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<QueryResponse | null>(null)
  // When non-null, the current `result` came from nl_query_log not from
  // a fresh edge-function call. Drives the "Showing previous run from
  // {time}" banner + Re-run button shown above the results table.
  const [pastRun, setPastRun] = useState<PastRunInfo | null>(null)
  const [showSql, setShowSql] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [recentRefresh, setRecentRefresh] = useState(0)

  const submit = useCallback(async (q: string) => {
    if (!q.trim() || running) return
    setRunning(true)
    setError(null)
    setPastRun(null)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('not signed in')
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
        },
        body: JSON.stringify({ question: q }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      const r = json as QueryResponse
      setResult(r)
      // Remember what produced this result for export/email actions,
      // then clear the textbox so Robin can type the next question
      // without manually wiping it.
      setSubmittedQuestion(q)
      setQuestion('')
      // Always collapse SQL — most users only want results + CSV.
      // The query-type pill still labels AI-generated runs.
      setShowSql(false)
      setRecentRefresh((n) => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setResult(null)
    } finally {
      setRunning(false)
    }
  }, [running])

  // Called by RecentQueries when the user taps a past question. We
  // render the SAVED result from nl_query_log instead of re-running
  // the query — saves AI credits and DB load, and matches what the
  // user actually wanted ("show me what it returned LAST time"). If
  // the log row predates the persistence migration (result_rows IS
  // NULL) we fall through to a re-run with a one-time notice.
  const showPast = useCallback((row: {
    id: number
    question: string
    sql_executed: string | null
    row_count: number | null
    duration_ms: number | null
    query_type: 'template' | 'generated'
    template_name: string | null
    created_at: string
    result_columns: string[] | null
    result_rows: Record<string, unknown>[] | null
    result_truncated: boolean | null
  }) => {
    if (!row.result_rows || !row.result_columns) {
      // Logged before result persistence shipped — re-run instead.
      setQuestion(row.question)
      setError('This question was asked before result history was enabled — re-running fresh.')
      submit(row.question)
      return
    }
    setError(null)
    setResult({
      rows: row.result_rows,
      columns: row.result_columns,
      sql: row.sql_executed ?? '',
      query_type: row.query_type,
      template_name: row.template_name ?? undefined,
      truncated: row.result_truncated ?? false,
      row_count: row.row_count ?? row.result_rows.length,
      duration_ms: row.duration_ms ?? 0,
    })
    setSubmittedQuestion(row.question)
    setQuestion('')
    setShowSql(false)
    setPastRun({ ranAt: row.created_at, isPartial: row.result_truncated ?? false })
  }, [submit])

  const exportCsv = useCallback(async () => {
    if (!result || exporting) return
    setExporting(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('not signed in')
      const res = await fetch(`${FUNCTION_URL}?export=csv`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
        },
        body: JSON.stringify({ question: submittedQuestion }),
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `nl-query-${Date.now()}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }, [result, submittedQuestion, exporting])

  const hasEmailCol = !!result?.columns.includes('email')

  function emailRecipients() {
    if (!result) return
    const emails = result.rows
      .map((r) => r.email)
      .filter((e): e is string => typeof e === 'string' && e.length > 0)
    if (emails.length === 0) return

    // Stash the recipient list in sessionStorage (tab-scoped, no DB
    // persistence — emails change frequently and full lists shouldn't
    // outlive the user's session). The new-template page picks them up.
    try {
      sessionStorage.setItem(
        RECIPIENTS_STORAGE_KEY,
        JSON.stringify({
          question,
          emails,
          capturedAt: new Date().toISOString(),
        }),
      )
    } catch {
      // Quota exceeded or sessionStorage unavailable — fall through and
      // navigate anyway; the email page will just show an empty chip.
    }
    router.push('/email/new?from=query')
  }

  const handleKey: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit(question)
    }
  }

  return (
    <div className="space-y-6">
      {/* Input row */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKey}
          placeholder="e.g. Give me all paid Aliens Expanded backers in the UK"
          rows={3}
          className="w-full bg-transparent text-white text-sm placeholder-zinc-600 focus:outline-none resize-none"
        />
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-3 pt-3 border-t border-zinc-800">
          <button
            onClick={() => setBrowserOpen(true)}
            className="text-xs text-zinc-400 hover:text-white transition-colors text-left"
          >
            Browse templates →
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-600 hidden sm:inline">⌘ + ↵ to run</span>
            <button
              onClick={() => submit(question)}
              disabled={running || !question.trim()}
              className="w-full sm:w-auto px-5 py-2.5 sm:py-1.5 text-sm font-bold rounded-md bg-[#3B9EE8] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#2d8ed8] transition-colors"
            >
              {running ? 'Running…' : 'Run'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-900/60 rounded-xl px-4 py-3">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Past-run banner — only when result came from nl_query_log,
          not a fresh edge-function call. Re-run button reuses submit()
          which automatically clears pastRun. */}
      {result && pastRun && (
        <div className="bg-amber-950/30 border border-amber-900/60 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-sm text-amber-200">
            <span className="font-medium">Previous run from {timeAgo(pastRun.ranAt)}</span>
            <span className="block text-xs text-amber-300/70 mt-0.5">
              For: &ldquo;{submittedQuestion}&rdquo;
              {pastRun.isPartial && ' · result truncated to first 100 rows'}
            </span>
          </div>
          <button
            onClick={() => submit(submittedQuestion)}
            disabled={running}
            className="w-full sm:w-auto px-4 py-2 text-xs font-bold rounded-md bg-amber-700/40 hover:bg-amber-700/60 text-amber-100 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {running ? 'Running…' : 'Re-run with fresh data'}
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                  result.query_type === 'template'
                    ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-900'
                    : 'bg-amber-900/40 text-amber-300 border border-amber-900'
                }`}
              >
                {result.query_type === 'template'
                  ? `Template: ${result.template_name}`
                  : 'AI-generated'}
              </span>
              <span className="text-xs text-zinc-400 tabular-nums">
                {result.row_count.toLocaleString()} rows
                {result.truncated && <span className="text-amber-400"> (capped)</span>}
                {' · '}{result.duration_ms} ms
              </span>
            </div>
            <div className="grid grid-cols-3 sm:flex sm:items-center gap-2">
              <button
                onClick={() => setShowSql((v) => !v)}
                className="px-3 py-2 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
              >
                {showSql ? 'Hide SQL' : 'Show SQL'}
              </button>
              <button
                onClick={exportCsv}
                disabled={exporting}
                className="px-3 py-2 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-50 transition-colors"
              >
                {exporting ? 'Exporting…' : 'Export CSV'}
              </button>
              <button
                onClick={emailRecipients}
                disabled={!hasEmailCol}
                title={hasEmailCol ? 'Hand off email list to mail flow' : 'Results need an email column'}
                className="px-3 py-2 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Email
              </button>
            </div>
          </div>

          {showSql && (
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
              {result.query_type === 'generated' && (
                <p className="text-xs text-amber-400 mb-2">
                  ⚠ AI-generated query — review before trusting the results.
                </p>
              )}
              <pre className="text-xs text-zinc-300 font-mono overflow-auto whitespace-pre-wrap break-all">
                {result.sql}
              </pre>
            </div>
          )}

          <QueryResultsTable rows={result.rows} columns={result.columns} />
        </div>
      )}

      {/* Recent — tapping a row loads its stored result (or re-runs if
          the row predates result persistence). */}
      <RecentQueries refreshKey={recentRefresh} onShowPast={showPast} />

      <TemplateBrowser
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onPick={(q) => { setQuestion(q); setBrowserOpen(false) }}
      />
    </div>
  )
}
