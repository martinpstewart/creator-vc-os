import Link from 'next/link'
import { Plus, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

type TemplateRow = {
  id: number
  name: string
  subject: string | null
  html: string
  updated_at: string
  created_by: string | null
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

export default async function EmailListPage() {
  const supabase = await createClient()
  const { data: templates, error } = await supabase
    .from('email_templates')
    .select('id, name, subject, html, updated_at, created_by')
    .order('updated_at', { ascending: false })
    .limit(60)

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6 md:mb-8 gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-white">Email</h1>
          <p className="text-sm text-zinc-500 mt-1">Drag-and-drop campaigns, drafts and templates</p>
        </div>
        <Link
          href="/email/new"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] transition-colors"
        >
          <Plus size={16} strokeWidth={2.25} />
          <span className="hidden sm:inline">New template</span>
          <span className="sm:hidden">New</span>
        </Link>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-900/60 rounded-xl px-4 py-3 mb-6">
          <p className="text-sm text-red-300">Couldn&apos;t load templates: {error.message}</p>
        </div>
      )}

      {templates && templates.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-16 text-center">
          <Mail size={32} className="mx-auto text-zinc-600 mb-3" strokeWidth={1.5} />
          <p className="text-sm text-zinc-300 font-medium mb-1">No templates yet</p>
          <p className="text-xs text-zinc-500 mb-5">Create one with the drag-and-drop builder</p>
          <Link
            href="/email/new"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] transition-colors"
          >
            <Plus size={16} strokeWidth={2.25} />
            New template
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {(templates as TemplateRow[] | null)?.map((t) => (
            <Link
              key={t.id}
              href={`/email/${t.id}`}
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
                <p className="text-[11px] text-zinc-600 mt-2">Updated {timeAgo(t.updated_at)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
