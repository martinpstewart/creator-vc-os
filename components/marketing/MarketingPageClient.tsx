'use client'

import { Mail } from 'lucide-react'
import ContactsManager from './ContactsManager'
import type { TemplateRow } from './types'

// TEMP — Emails and Landing Pages tabs are hidden for now; the screen
// only surfaces Contacts. The other managers + their server-loaded
// data (templates query in page.tsx) remain in the codebase so this
// is one revert away. To restore: re-add the PillButton tab strip,
// re-add the EmailsManager / LandingPagesManager imports + panels,
// and accept the `initialTab` / `templates` props again.
//
// Imports kept on the page-server level so MarketingPageClient still
// receives them and types check — but they're unused in this build.

export default function MarketingPageClient({
  templates: _templates,
}: {
  initialTab: 'emails' | 'contacts' | 'landing'
  templates: TemplateRow[]
}) {
  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6 md:mb-8 gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-9 h-9 md:w-10 md:h-10 rounded-lg bg-[#3B9EE8]">
            <Mail size={18} className="text-white" strokeWidth={2.25} />
          </span>
          <div>
            <h1 className="text-xl md:text-2xl font-semibold text-white">Marketing</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Contacts and segments
            </p>
          </div>
        </div>
      </div>

      <ContactsManager />
    </div>
  )
}
