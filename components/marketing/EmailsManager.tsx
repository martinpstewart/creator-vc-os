'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import TemplatesGrid from './TemplatesGrid'
import SendsList from './SendsList'
import type { TemplateRow } from './types'

type SubTab = 'templates' | 'history'

export default function EmailsManager({ templates }: { templates: TemplateRow[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const urlSub = searchParams.get('sub')
  const [subTab, setSubTab] = useState<SubTab>(urlSub === 'history' ? 'history' : 'templates')

  function selectSubTab(next: SubTab) {
    setSubTab(next)
    const sp = new URLSearchParams(searchParams.toString())
    if (next === 'templates') sp.delete('sub')
    else sp.set('sub', next)
    startTransition(() => {
      router.replace(`${pathname}${sp.toString() ? `?${sp.toString()}` : ''}`, { scroll: false })
    })
  }

  return (
    <div>
      {/* Sub-tab strip + scoped CTA */}
      <div className="flex items-center justify-between mb-5 border-b border-zinc-800">
        <div className="flex items-center gap-1" role="tablist" aria-label="Emails sub-navigation">
          <SubTabButton
            active={subTab === 'templates'}
            onClick={() => selectSubTab('templates')}
            label="Templates"
            count={templates.length}
          />
          <SubTabButton
            active={subTab === 'history'}
            onClick={() => selectSubTab('history')}
            label="History"
          />
        </div>
        {subTab === 'templates' && (
          <Link
            href="/marketing/new"
            className="inline-flex items-center gap-2 mb-2 px-3 py-1.5 text-xs font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] transition-colors"
          >
            <Plus size={14} strokeWidth={2.25} />
            New template
          </Link>
        )}
      </div>

      {/* Panes — both kept mounted so SendsList state survives sub-tab switches */}
      <div role="tabpanel" hidden={subTab !== 'templates'}>
        <TemplatesGrid templates={templates} />
      </div>
      <div role="tabpanel" hidden={subTab !== 'history'}>
        <SendsList />
      </div>
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
