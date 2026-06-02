'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import ContactsList from './ContactsList'
import SegmentBuilder from './SegmentBuilder'
import SavedSegmentsList from './SavedSegmentsList'
import type { CampaignLite, SegmentDefinition, SegmentRow } from './types'

type EditingState = {
  id: number | null
  name: string | null
  description: string | null
  definition: SegmentDefinition | undefined
}

type SubTab = 'people' | 'segments'

const EMPTY_EDITING: EditingState = { id: null, name: null, description: null, definition: undefined }

export default function ContactsManager() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  // Initial sub-tab from URL (?sub=segments). Default to people.
  const urlSub = searchParams.get('sub')
  const [subTab, setSubTab] = useState<SubTab>(urlSub === 'segments' ? 'segments' : 'people')

  const [campaigns, setCampaigns] = useState<CampaignLite[]>([])
  const [segments, setSegments] = useState<SegmentRow[]>([])
  const [editing, setEditing] = useState<EditingState>(EMPTY_EDITING)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const loadSegments = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('marketing_list_segments')
      if (error) throw error
      setSegments((data as SegmentRow[]) ?? [])
    } catch (e) {
      setBootstrapError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // Bootstrap: campaigns (once) + segments.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const supabase = createClient()
        const [{ data: camps, error: ce }, _segments] = await Promise.all([
          supabase.rpc('get_campaigns'),
          loadSegments(),
        ])
        if (cancelled) return
        if (ce) throw ce
        type CampRow = { id: number; name: string }
        const list = ((camps as CampRow[]) ?? []).map((c) => ({ id: c.id, name: c.name }))
        list.sort((a, b) => a.name.localeCompare(b.name))
        setCampaigns(list)
        setLoaded(true)
      } catch (e) {
        if (!cancelled) setBootstrapError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadSegments])

  function selectSubTab(next: SubTab) {
    setSubTab(next)
    const sp = new URLSearchParams(searchParams.toString())
    if (next === 'people') sp.delete('sub')
    else sp.set('sub', next)
    startTransition(() => {
      router.replace(`${pathname}${sp.toString() ? `?${sp.toString()}` : ''}`, { scroll: false })
    })
  }

  function startEdit(s: SegmentRow) {
    setEditing({
      id: s.id,
      name: s.name,
      description: s.description,
      definition: s.definition,
    })
    // We're already on the Segments sub-tab (Edit lives there), but if
    // somehow not, switch to it so the builder is visible.
    if (subTab !== 'segments') selectSubTab('segments')
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        document.getElementById('segment-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }

  function cancelEdit() {
    setEditing(EMPTY_EDITING)
  }

  async function handleSaved() {
    await loadSegments()
    setEditing(EMPTY_EDITING)
  }

  if (bootstrapError) {
    return (
      <div className="bg-red-950/40 border border-red-900/60 rounded-xl px-4 py-3">
        <p className="text-sm text-red-300">Couldn&apos;t load Contacts: {bootstrapError}</p>
      </div>
    )
  }

  return (
    <div>
      {/* Sub-tabs — underline style to convey hierarchy under the parent pills */}
      <div className="border-b border-zinc-800 mb-5">
        <div className="flex items-center gap-1" role="tablist" aria-label="Contacts sub-navigation">
          <SubTabButton
            active={subTab === 'people'}
            onClick={() => selectSubTab('people')}
            label="Contacts"
          />
          <SubTabButton
            active={subTab === 'segments'}
            onClick={() => selectSubTab('segments')}
            label="Segments"
            count={segments.length}
          />
        </div>
      </div>

      {/* Panes — both kept mounted so filter / builder state survives sub-tab switches */}
      <div role="tabpanel" hidden={subTab !== 'people'}>
        <ContactsList />
      </div>

      <div role="tabpanel" hidden={subTab !== 'segments'}>
        <div className="space-y-6">
          <div id="segment-builder">
            {loaded ? (
              <SegmentBuilder
                campaigns={campaigns}
                initialDefinition={editing.definition}
                editingSegmentId={editing.id}
                editingSegmentName={editing.name}
                editingSegmentDescription={editing.description}
                onSaved={handleSaved}
                onCancelEdit={cancelEdit}
              />
            ) : (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-6 text-sm text-zinc-500">
                Loading campaigns…
              </div>
            )}
          </div>
          <SavedSegmentsList segments={segments} onEdit={startEdit} onChanged={loadSegments} />
        </div>
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
