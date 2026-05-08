'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

type TemplateMeta = {
  name: string
  description: string
  example_questions: string[]
  params: { name: string; type: string; required: boolean; default?: unknown }[]
}

export default function TemplateBrowser({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (question: string) => void
}) {
  const [templates, setTemplates] = useState<TemplateMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || templates) return
    let cancelled = false
    ;(async () => {
      try {
        const supabase = createClient()
        const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/nl-query?list_templates=true`
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${session?.access_token ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
          },
        })
        if (!res.ok) throw new Error(`templates list ${res.status}`)
        const json = await res.json() as { templates: TemplateMeta[] }
        if (!cancelled) setTemplates(json.templates)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [open, templates])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <aside
        className="relative w-full max-w-md h-full bg-zinc-950 border-l border-zinc-800 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-5 py-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Templates</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white text-sm"
          >
            ✕
          </button>
        </div>
        <div className="p-5 space-y-4">
          {error && <p className="text-sm text-red-400">Failed to load: {error}</p>}
          {!templates && !error && <p className="text-sm text-zinc-500">Loading…</p>}
          {templates?.map((t) => (
            <div key={t.name} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <p className="text-xs font-mono text-[#3B9EE8] mb-1">{t.name}</p>
              <p className="text-sm text-white mb-2">{t.description}</p>
              <div className="space-y-1.5">
                {t.example_questions.map((q) => (
                  <button
                    key={q}
                    onClick={() => onPick(q)}
                    className="block w-full text-left text-xs text-zinc-400 hover:text-white hover:bg-zinc-800/60 rounded px-2 py-1.5 transition-colors"
                  >
                    “{q}”
                  </button>
                ))}
              </div>
              {t.params.length > 0 && (
                <p className="text-[10px] text-zinc-600 mt-2 font-mono">
                  params: {t.params.map((p) => `${p.name}${p.required ? '' : '?'}`).join(', ')}
                </p>
              )}
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}
