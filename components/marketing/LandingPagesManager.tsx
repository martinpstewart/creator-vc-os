'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import LandingTemplatesGrid from './LandingTemplatesGrid'
import PagesList from './PagesList'
import NewPageModal from './NewPageModal'
import type { LandingTemplateRow, MicrositeRow } from './types'

type SubTab = 'templates' | 'pages'

export default function LandingPagesManager() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const urlSub = searchParams.get('sub')
  const [subTab, setSubTab] = useState<SubTab>(urlSub === 'pages' ? 'pages' : 'templates')

  const [templates, setTemplates] = useState<LandingTemplateRow[]>([])
  const [pages, setPages] = useState<MicrositeRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showNewPage, setShowNewPage] = useState(false)

  const loadAll = useCallback(async () => {
    try {
      const supabase = createClient()
      const [{ data: t, error: e1 }, { data: p, error: e2 }] = await Promise.all([
        supabase.rpc('marketing_list_landing_templates'),
        supabase.rpc('marketing_list_microsites'),
      ])
      if (e1) throw e1
      if (e2) throw e2
      setTemplates((t as LandingTemplateRow[]) ?? [])
      setPages((p as MicrositeRow[]) ?? [])
      setLoaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  function selectSubTab(next: SubTab) {
    setSubTab(next)
    const sp = new URLSearchParams(searchParams.toString())
    if (next === 'templates') sp.delete('sub')
    else sp.set('sub', next)
    startTransition(() => {
      router.replace(`${pathname}${sp.toString() ? `?${sp.toString()}` : ''}`, { scroll: false })
    })
  }

  if (error) {
    return (
      <div className="bg-red-950/40 border border-red-900/60 rounded-xl px-4 py-3">
        <p className="text-sm text-red-300">Couldn&apos;t load Landing Pages: {error}</p>
      </div>
    )
  }

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex items-center justify-between mb-5 border-b border-zinc-800">
        <div className="flex items-center gap-1" role="tablist" aria-label="Landing Pages sub-navigation">
          <SubTabButton
            active={subTab === 'templates'}
            onClick={() => selectSubTab('templates')}
            label="Templates"
            count={loaded ? templates.length : undefined}
          />
          <SubTabButton
            active={subTab === 'pages'}
            onClick={() => selectSubTab('pages')}
            label="Pages"
            count={loaded ? pages.length : undefined}
          />
        </div>
        {subTab === 'templates' && (
          <Link
            href="/marketing/landing/new"
            className="inline-flex items-center gap-2 mb-2 px-3 py-1.5 text-xs font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] transition-colors"
          >
            <Plus size={14} strokeWidth={2.25} />
            New landing template
          </Link>
        )}
        {subTab === 'pages' && (
          <button
            onClick={() => setShowNewPage(true)}
            className="inline-flex items-center gap-2 mb-2 px-3 py-1.5 text-xs font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] transition-colors"
          >
            <Plus size={14} strokeWidth={2.25} />
            New page
          </button>
        )}
      </div>

      {showNewPage && (
        <NewPageModal
          templates={templates}
          onClose={() => setShowNewPage(false)}
          onCreated={loadAll}
        />
      )}

      {!loaded ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-12 text-center text-sm text-zinc-500">
          Loading…
        </div>
      ) : (
        <>
          <div role="tabpanel" hidden={subTab !== 'templates'}>
            <LandingTemplatesGrid templates={templates} onChanged={loadAll} />
          </div>
          <div role="tabpanel" hidden={subTab !== 'pages'}>
            <PagesList pages={pages} />
          </div>
        </>
      )}
    </div>
  )
}

function SubTabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count?: number
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-colors -mb-px border-b-2 ${
        active
          ? 'border-[#3B9EE8] text-white'
          : 'border-transparent text-zinc-500 hover:text-zinc-200'
      }`}
    >
      <span>{label}</span>
      {count != null && (
        <span
          className={`text-[11px] tabular-nums px-1.5 py-0.5 rounded ${
            active ? 'bg-zinc-800 text-zinc-200' : 'bg-zinc-900 text-zinc-500'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}
