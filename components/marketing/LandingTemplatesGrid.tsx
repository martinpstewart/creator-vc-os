'use client'

import Link from 'next/link'
import { LayoutTemplate, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { relTime, type LandingTemplateRow } from './types'

export default function LandingTemplatesGrid({
  templates,
  onChanged,
}: {
  templates: LandingTemplateRow[]
  onChanged: () => void
}) {
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete(t: LandingTemplateRow, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Delete "${t.name}"? This cannot be undone.`)) return
    setBusyId(t.id)
    setError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.rpc('marketing_delete_landing_template', { p_id: t.id })
      if (error) throw error
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  if (templates.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-16 text-center">
        <LayoutTemplate size={32} className="mx-auto text-zinc-600 mb-3" strokeWidth={1.5} />
        <p className="text-sm text-zinc-300 font-medium mb-1">No landing templates yet</p>
        <p className="text-xs text-zinc-500 mb-5">
          Build a reusable landing page with the drag-and-drop editor.
        </p>
        <Link
          href="/marketing/landing/new"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] transition-colors"
        >
          <Plus size={16} strokeWidth={2.25} />
          New landing template
        </Link>
      </div>
    )
  }

  return (
    <>
      {error && (
        <div className="bg-red-950/40 border border-red-900/60 rounded-xl px-4 py-3 mb-4">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        {templates.map((t) => (
          <Link
            key={t.id}
            href={`/marketing/landing/${t.id}`}
            className="relative bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-700 transition-colors group"
          >
            <div className="h-40 bg-white relative overflow-hidden">
              {t.html ? (
                <iframe
                  srcDoc={t.html}
                  sandbox=""
                  className="w-[1024px] h-[640px] origin-top-left scale-[0.4] border-0 pointer-events-none"
                  aria-hidden="true"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-400 text-xs">
                  No preview yet
                </div>
              )}
            </div>
            <div className="p-4 border-t border-zinc-800">
              <p className="text-sm font-semibold text-white truncate group-hover:text-[#3B9EE8] transition-colors">
                {t.name}
              </p>
              {t.description && (
                <p className="text-xs text-zinc-500 mt-0.5 truncate">{t.description}</p>
              )}
              <p className="text-[11px] text-zinc-600 mt-2">Updated {relTime(t.updated_at)}</p>
            </div>
            <button
              onClick={(e) => handleDelete(t, e)}
              disabled={busyId === t.id}
              aria-label="Delete template"
              className="absolute top-2 right-2 p-1.5 rounded bg-zinc-950/80 backdrop-blur text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-40"
            >
              <Trash2 size={14} />
            </button>
          </Link>
        ))}
      </div>
    </>
  )
}
