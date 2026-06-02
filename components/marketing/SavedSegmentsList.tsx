'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Pencil, Trash2, Copy } from 'lucide-react'
import { relTime, type SegmentRow } from './types'

function fmt(n: number | null): string {
  if (n === null) return '—'
  return new Intl.NumberFormat('en-US').format(n)
}

export default function SavedSegmentsList({
  segments,
  onEdit,
  onChanged,
}: {
  segments: SegmentRow[]
  onEdit: (s: SegmentRow) => void
  onChanged: () => void
}) {
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete(s: SegmentRow) {
    if (!confirm(`Delete segment "${s.name}"? This cannot be undone.`)) return
    setBusyId(s.id)
    setError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .rpc('marketing_delete_segment', { p_id: s.id })
      if (error) throw error
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function handleDuplicate(s: SegmentRow) {
    setBusyId(s.id)
    setError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .rpc('marketing_upsert_segment', {
          p_name: `${s.name} (copy)`,
          p_description: s.description,
          p_definition: s.definition,
          p_id: null,
        })
      if (error) throw error
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-white">Saved segments</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          {segments.length === 0
            ? 'Nothing saved yet — build a segment above and hit Save.'
            : `${segments.length} segment${segments.length === 1 ? '' : 's'}`}
        </p>
      </div>

      {error && (
        <div className="bg-red-950/40 border-b border-red-900/60 px-5 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {segments.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/40">
                <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                  Name
                </th>
                <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                  Description
                </th>
                <th className="text-right px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                  Count
                </th>
                <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap">
                  Updated
                </th>
                <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap">
                  Created by
                </th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.id} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                  <td className="px-5 py-3 font-medium text-white">{s.name}</td>
                  <td className="px-5 py-3 text-zinc-400 text-xs max-w-xs truncate" title={s.description ?? ''}>
                    {s.description || '—'}
                  </td>
                  <td className="px-5 py-3 text-right text-zinc-300 tabular-nums">
                    {fmt(s.last_evaluated_count)}
                  </td>
                  <td className="px-5 py-3 text-zinc-500 text-xs whitespace-nowrap">{relTime(s.updated_at)}</td>
                  <td className="px-5 py-3 text-zinc-500 text-xs">{s.created_by || '—'}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onEdit(s)}
                        disabled={busyId === s.id}
                        className="p-1.5 rounded text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-40"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDuplicate(s)}
                        disabled={busyId === s.id}
                        className="p-1.5 rounded text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-40"
                        title="Duplicate"
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(s)}
                        disabled={busyId === s.id}
                        className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors disabled:opacity-40"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
