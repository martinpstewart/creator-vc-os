'use client'

import { useCallback, useState } from 'react'
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

const FUNCTION_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/nl-query`

export default function QueryConsole() {
  const [question, setQuestion] = useState('')
  const [running, setRunning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<QueryResponse | null>(null)
  const [showSql, setShowSql] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [recentRefresh, setRecentRefresh] = useState(0)

  const submit = useCallback(async (q: string) => {
    if (!q.trim() || running) return
    setRunning(true)
    setError(null)
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
      // Auto-expand SQL panel for AI-generated results.
      setShowSql(r.query_type === 'generated')
      setRecentRefresh((n) => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setResult(null)
    } finally {
      setRunning(false)
    }
  }, [running])

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
        body: JSON.stringify({ question }),
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
  }, [result, question, exporting])

  const hasEmailCol = !!result?.columns.includes('email')

  function emailRecipients() {
    if (!result) return
    const emails = result.rows.map((r) => r.email).filter((e): e is string => typeof e === 'string')
    // TODO: Wire to SES/Unlayer email feature when it ships. For now,
    //       hand off the recipient list — replace with router.push to
    //       the compose flow once that route exists.
    console.log('[email handoff]', emails.length, 'recipients', emails)
    alert(`Email feature not wired yet. ${emails.length} recipients ready to hand off.\n\nFirst few:\n${emails.slice(0, 5).join('\n')}`)
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
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-800">
          <button
            onClick={() => setBrowserOpen(true)}
            className="text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Browse templates →
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-600 hidden sm:inline">⌘ + ↵ to run</span>
            <button
              onClick={() => submit(question)}
              disabled={running || !question.trim()}
              className="px-4 py-1.5 text-sm font-bold rounded-md bg-[#3B9EE8] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#2d8ed8] transition-colors"
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

      {/* Results */}
      {result && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
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
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSql((v) => !v)}
                className="px-3 py-1.5 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
              >
                {showSql ? 'Hide SQL' : 'Show SQL'}
              </button>
              <button
                onClick={exportCsv}
                disabled={exporting}
                className="px-3 py-1.5 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-50 transition-colors"
              >
                {exporting ? 'Exporting…' : 'Export CSV'}
              </button>
              <button
                onClick={emailRecipients}
                disabled={!hasEmailCol}
                title={hasEmailCol ? 'Hand off email list to mail flow' : 'Results need an email column'}
                className="px-3 py-1.5 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Email recipients
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

      {/* Recent */}
      <RecentQueries refreshKey={recentRefresh} onRerun={(q) => { setQuestion(q); submit(q) }} />

      <TemplateBrowser
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onPick={(q) => { setQuestion(q); setBrowserOpen(false) }}
      />
    </div>
  )
}
