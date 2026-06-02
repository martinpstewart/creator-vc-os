'use client'

import { useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import EmailsManager from './EmailsManager'
import ContactsManager from './ContactsManager'
import LandingPagesManager from './LandingPagesManager'
import type { TemplateRow } from './types'

type Tab = 'emails' | 'contacts' | 'landing'

export default function MarketingPageClient({
  initialTab,
  templates,
}: {
  initialTab: Tab
  templates: TemplateRow[]
}) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  function selectTab(next: Tab) {
    setTab(next)
    // Keep URL in sync so reloads/back-forward preserve the tab.
    // `?sub=` is a per-parent-tab marker (each parent owns its own
    // sub-tab value space). Strip it when switching parents so a stale
    // value can't leak across siblings.
    const sp = new URLSearchParams(searchParams.toString())
    sp.delete('sub')
    if (next === 'emails') {
      sp.delete('tab')
    } else {
      sp.set('tab', next)
    }
    startTransition(() => {
      router.replace(`${pathname}${sp.toString() ? `?${sp.toString()}` : ''}`, { scroll: false })
    })
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6 md:mb-8 gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-white">Marketing</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Emails, contacts, segments and landing pages — all in one place
          </p>
        </div>
      </div>

      {/* Top-level pill tabs */}
      <div className="flex items-center gap-2 mb-6" role="tablist">
        <PillButton
          active={tab === 'emails'}
          onClick={() => selectTab('emails')}
          label="Emails"
          count={templates.length}
        />
        <PillButton
          active={tab === 'contacts'}
          onClick={() => selectTab('contacts')}
          label="Contacts"
          count={null}
        />
        <PillButton
          active={tab === 'landing'}
          onClick={() => selectTab('landing')}
          label="Landing Pages"
          count={null}
        />
      </div>

      <div role="tabpanel" hidden={tab !== 'emails'}>
        {tab === 'emails' && <EmailsManager templates={templates} />}
      </div>
      <div role="tabpanel" hidden={tab !== 'contacts'}>
        {tab === 'contacts' && <ContactsManager />}
      </div>
      <div role="tabpanel" hidden={tab !== 'landing'}>
        {tab === 'landing' && <LandingPagesManager />}
      </div>
    </div>
  )
}

function PillButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number | null
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`
        group relative flex items-center gap-2.5 px-5 py-2.5 rounded-full
        text-sm font-bold tracking-tight transition-all duration-150
        ${
          active
            ? 'bg-[#3B9EE8] text-white shadow-[0_0_0_1px_rgba(59,158,232,0.4),0_4px_20px_-4px_rgba(59,158,232,0.5)]'
            : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-white hover:border-zinc-700 hover:bg-zinc-800/60'
        }
      `}
    >
      <span>{label}</span>
      {count !== null && (
        <span
          className={`
            inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full
            text-[11px] font-bold tabular-nums
            ${
              active
                ? 'bg-white/20 text-white'
                : 'bg-zinc-800 text-zinc-400 group-hover:bg-zinc-700 group-hover:text-zinc-200'
            }
          `}
        >
          {count}
        </span>
      )}
    </button>
  )
}
