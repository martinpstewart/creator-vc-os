'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

type LogRow = {
  id: number
  created_at: string
  question: string
  query_type: 'template' | 'generated'
  template_name: string | null
  row_count: number | null
  duration_ms: number | null
  success: boolean
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export default function RecentQueries({
  refreshKey,
  onRerun,
}: {
  refreshKey: number
  onRerun: (question: string) => void
}) {
  const [rows, setRows] = useState<LogRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('nl_query_log')
        .select('id, created_at, question, query_type, template_name, row_count, duration_ms, success')
        .order('created_at', { ascending: false })
        .limit(20)
      if (!cancelled) {
        if (error) setRows([])
        else setRows((data ?? []) as LogRow[])
      }
    })()
    return () => { cancelled = true }
  }, [refreshKey])

  if (!rows) return null
  if (rows.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-sm text-zinc-500">
        No previous queries yet.
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
      <div className="px-5 py-3 border-b border-zinc-800">
        <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Recent</h2>
      </div>
      <ul className="divide-y divide-zinc-800/60">
        {rows.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => onRerun(r.question)}
              className="w-full text-left px-5 py-3 hover:bg-zinc-800/40 transition-colors"
            >
              <p className="text-sm text-white truncate">{r.question}</p>
              <p className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2">
                <span
                  className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    r.query_type === 'template'
                      ? 'bg-emerald-900/40 text-emerald-400'
                      : 'bg-amber-900/40 text-amber-400'
                  }`}
                >
                  {r.query_type === 'template' ? r.template_name ?? 'template' : 'AI'}
                </span>
                {r.success ? (
                  <span>{r.row_count?.toLocaleString() ?? 0} rows · {r.duration_ms}ms</span>
                ) : (
                  <span className="text-red-400">failed</span>
                )}
                <span className="text-zinc-600">·</span>
                <span>{timeAgo(r.created_at)}</span>
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
