'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { RefreshCw } from 'lucide-react'
import type { SegmentRow } from './types'

function fmt(n: number | null): string {
  if (n === null) return '—'
  return new Intl.NumberFormat('en-US').format(n)
}

export default function SegmentPickerForTemplate({
  value,
  onChange,
}: {
  value: number | null
  onChange: (id: number | null) => void
}) {
  const [segments, setSegments] = useState<SegmentRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [liveCount, setLiveCount] = useState<number | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)

  // Load segments once on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const supabase = createClient()
        const { data, error } = await supabase
          .rpc('marketing_list_segments')
        if (cancelled) return
        if (error) throw error
        const list = ((data as SegmentRow[]) ?? []).sort((a, b) =>
          a.name.localeCompare(b.name),
        )
        setSegments(list)
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Clear live count when the selected segment changes.
  useEffect(() => {
    setLiveCount(null)
    setRefreshedAt(null)
  }, [value])

  const selected = segments?.find((s) => s.id === value) ?? null
  const savedCount = selected?.last_evaluated_count ?? null
  const displayCount = liveCount ?? savedCount

  async function refresh() {
    if (!selected) return
    setRefreshing(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .rpc('marketing_count_segment', { p_definition: selected.definition })
      if (error) throw error
      setLiveCount(typeof data === 'number' ? data : Number(data ?? 0))
      setRefreshedAt(new Date())
    } catch (e) {
      console.error('[SegmentPicker] refresh failed', e)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <span className="text-zinc-500 shrink-0">Send to</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
        className="bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1.5 text-white focus:outline-none focus:border-zinc-600 min-w-[220px] max-w-[360px]"
        disabled={segments === null && !loadError}
      >
        <option value="">— No segment —</option>
        {segments?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.last_evaluated_count != null
              ? ` · ${new Intl.NumberFormat('en-US').format(s.last_evaluated_count)}`
              : ''}
          </option>
        ))}
      </select>

      {selected && (
        <button
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh count"
          title="Re-count contacts now"
          className="inline-flex items-center justify-center p-1.5 rounded border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} strokeWidth={2} />
        </button>
      )}

      {selected && (
        <span className="text-zinc-500 tabular-nums">
          {displayCount !== null ? fmt(displayCount) : '—'} contacts
          {refreshedAt && (
            <span className="text-zinc-700 ml-1">
              · refreshed {refreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </span>
      )}

      {loadError && (
        <span className="text-red-400 text-[10px]" title={loadError}>
          segments unavailable
        </span>
      )}
    </div>
  )
}
