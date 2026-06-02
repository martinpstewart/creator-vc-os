'use client'

import Link from 'next/link'
import { Plus, Mail } from 'lucide-react'
import { relTime, type TemplateRow } from './types'

export default function TemplatesGrid({ templates }: { templates: TemplateRow[] }) {
  if (templates.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-16 text-center">
        <Mail size={32} className="mx-auto text-zinc-600 mb-3" strokeWidth={1.5} />
        <p className="text-sm text-zinc-300 font-medium mb-1">No templates yet</p>
        <p className="text-xs text-zinc-500 mb-5">Create one with the drag-and-drop builder</p>
        <Link
          href="/marketing/new"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] transition-colors"
        >
          <Plus size={16} strokeWidth={2.25} />
          New template
        </Link>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
      {templates.map((t) => (
        <Link
          key={t.id}
          href={`/marketing/${t.id}`}
          className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-700 transition-colors group"
        >
          {/* Sandboxed iframe preview of the saved HTML */}
          <div className="h-40 bg-white relative overflow-hidden">
            <iframe
              srcDoc={t.html}
              sandbox=""
              className="w-[1024px] h-[640px] origin-top-left scale-[0.4] border-0 pointer-events-none"
              aria-hidden="true"
            />
          </div>
          <div className="p-4 border-t border-zinc-800">
            <p className="text-sm font-semibold text-white truncate group-hover:text-[#3B9EE8] transition-colors">
              {t.name}
            </p>
            {t.subject && (
              <p className="text-xs text-zinc-500 mt-0.5 truncate">{t.subject}</p>
            )}
            <div className="flex items-center justify-between mt-2 text-[11px]">
              <span className="text-zinc-600">Updated {relTime(t.updated_at)}</span>
              {t.segment_id != null && (
                <span className="inline-flex px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px] font-semibold">
                  Has segment
                </span>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}
