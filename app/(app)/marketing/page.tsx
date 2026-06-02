import { createClient } from '@/lib/supabase-server'
import MarketingPageClient from '@/components/marketing/MarketingPageClient'
import type { TemplateRow } from '@/components/marketing/types'

export const dynamic = 'force-dynamic'

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  // Legacy '?tab=templates' bookmarks still work — they map to the new
  // 'emails' parent tab which contains the Templates sub-tab.
  const initialTab =
    tab === 'contacts' ? 'contacts'
    : tab === 'landing' ? 'landing'
    : 'emails'

  const supabase = await createClient()
  const { data: templates, error } = await supabase
    .from('email_templates')
    .select('id, name, subject, html, updated_at, segment_id')
    .order('updated_at', { ascending: false })
    .limit(60)

  if (error) {
    return (
      <div className="p-4 md:p-8">
        <div className="bg-red-950/40 border border-red-900/60 rounded-xl px-4 py-3">
          <p className="text-sm text-red-300">Couldn&apos;t load templates: {error.message}</p>
        </div>
      </div>
    )
  }

  return (
    <MarketingPageClient
      initialTab={initialTab}
      templates={(templates as TemplateRow[] | null) ?? []}
    />
  )
}
