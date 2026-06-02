'use client'

import Link from 'next/link'
import { BarChart3, ExternalLink, Globe, Pencil } from 'lucide-react'
import { relTime, micrositeStatusTone, type MicrositeRow } from './types'

export default function PagesList({ pages }: { pages: MicrositeRow[] }) {
  if (pages.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-16 text-center">
        <Globe size={32} className="mx-auto text-zinc-600 mb-3" strokeWidth={1.5} />
        <p className="text-sm text-zinc-300 font-medium mb-1">No pages yet</p>
        <p className="text-xs text-zinc-500 max-w-md mx-auto">
          Click <span className="text-zinc-300 font-medium">New page</span> above to spin one up
          — start blank or from a saved landing template.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
      {pages.map((p) => {
        const tone = micrositeStatusTone(p.status)
        const liveTs = p.published_at ?? p.updated_at ?? p.created_at
        const editHref = `/marketing/pages/${p.id}`
        return (
          <article
            key={p.id}
            className="group relative bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-700 transition-colors"
          >
            {/* Whole-card click-target → editor. The "View live" link
                inside stops propagation so it doesn't get hijacked. */}
            <Link
              href={editHref}
              className="absolute inset-0 z-10"
              aria-label={`Edit ${p.title}`}
            />

            <div className="h-44 bg-white relative overflow-hidden">
              {p.html_cached ? (
                <iframe
                  srcDoc={p.html_cached}
                  sandbox=""
                  className="w-[1024px] h-[768px] origin-top-left scale-[0.4] border-0 pointer-events-none"
                  aria-hidden="true"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-400 text-xs">
                  No rendered HTML yet
                </div>
              )}
              <span
                className={`absolute top-2 right-2 inline-flex px-2 py-0.5 rounded text-[10px] font-semibold border ${tone.bg} ${tone.text} ${tone.border}`}
              >
                {tone.label}
              </span>
            </div>

            <div className="p-4 border-t border-zinc-800 relative z-20 pointer-events-none">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate group-hover:text-[#3B9EE8] transition-colors">
                    {p.title}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5 truncate font-mono">
                    /p/{p.slug}
                    {p.campaign_name && (
                      <span className="font-sans not-italic">
                        <span className="text-zinc-700 mx-1.5">·</span>
                        {p.campaign_name}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0 pointer-events-auto">
                  {p.status === 'live' && (
                    <a
                      href={`/p/${p.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-zinc-300 hover:text-white hover:bg-zinc-800/80 transition-colors"
                      title="Open live page in a new tab"
                    >
                      View <ExternalLink size={11} />
                    </a>
                  )}
                  <Link
                    href={editHref}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-zinc-300 hover:text-white hover:bg-zinc-800/80 transition-colors relative z-30"
                    title="Edit page design + metadata"
                  >
                    <Pencil size={11} /> Update
                  </Link>
                  <Link
                    href={`/marketing/pages/${p.id}/dashboard`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-zinc-300 hover:text-white hover:bg-zinc-800/80 transition-colors relative z-30"
                    title="Signup metrics, timeline, country breakdown"
                  >
                    <BarChart3 size={11} /> Dashboard
                  </Link>
                </div>
              </div>
              {p.description && (
                <p className="text-xs text-zinc-400 mt-2 line-clamp-2">{p.description}</p>
              )}
              <div className="flex items-center gap-3 mt-3 text-[11px] text-zinc-600">
                {p.status === 'live' && p.published_at ? (
                  <span>Live since {relTime(p.published_at)}</span>
                ) : p.status === 'closed' && p.closed_at ? (
                  <span>Closed {relTime(p.closed_at)}</span>
                ) : (
                  <span>Updated {relTime(liveTs)}</span>
                )}
                {p.created_by && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span>by {p.created_by}</span>
                  </>
                )}
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
