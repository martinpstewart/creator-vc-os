'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Plus, X, Save, Users } from 'lucide-react'
import {
  COUNTRY_OPTIONS,
  ROLE_LABELS,
  normaliseSegmentDefinition,
  type CampaignEngagementRole,
  type CampaignLite,
  type FilterType,
  type SegmentDefinition,
  type SegmentFilter,
} from './types'

const FILTER_TYPE_OPTIONS: { value: FilterType; label: string }[] = [
  { value: 'campaign_engagement', label: 'Campaign engagement' },
  { value: 'consent', label: 'Marketing consent' },
  { value: 'total_spend_gte', label: 'Total spend at least (£)' },
  { value: 'total_spend_lte', label: 'Total spend at most (£)' },
  { value: 'total_orders_gte', label: 'Total orders at least' },
  { value: 'total_orders_lte', label: 'Total orders at most' },
  { value: 'signed_up_after', label: 'Signed up after' },
  { value: 'signed_up_before', label: 'Signed up before' },
  { value: 'country_in', label: 'Country' },
  { value: 'is_test', label: 'Test contacts (safe-send)' },
]

function defaultFilterFor(type: FilterType, _campaigns: CampaignLite[]): SegmentFilter {
  switch (type) {
    case 'campaign_engagement':
      // Start with an empty campaign selection — the row shows a
      // "pick campaigns" hint so nothing counts as "backed" until the
      // user makes an explicit choice.
      return { type, campaign_ids: [], role: 'backer' }
    case 'consent':
      return { type, consented: true }
    case 'total_spend_gte':
    case 'total_spend_lte':
      return { type, value_pence: 0 }
    case 'total_orders_gte':
    case 'total_orders_lte':
      return { type, value: 1 }
    case 'signed_up_after':
    case 'signed_up_before':
      return { type, date: new Date().toISOString().slice(0, 10) }
    case 'country_in':
      return { type, codes: [] }
    case 'is_test':
      return { type, value: true }
  }
}

function fmt(n: number | null): string {
  if (n === null) return '—'
  return new Intl.NumberFormat('en-US').format(n)
}

export default function SegmentBuilder({
  campaigns,
  initialDefinition,
  editingSegmentId,
  editingSegmentName,
  editingSegmentDescription,
  onSaved,
  onCancelEdit,
}: {
  campaigns: CampaignLite[]
  initialDefinition?: SegmentDefinition
  editingSegmentId?: number | null
  editingSegmentName?: string | null
  editingSegmentDescription?: string | null
  onSaved: () => void
  onCancelEdit: () => void
}) {
  const [definition, setDefinition] = useState<SegmentDefinition>(
    initialDefinition ? normaliseSegmentDefinition(initialDefinition) : { match: 'all', filters: [] },
  )
  const [count, setCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  const [countError, setCountError] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)

  // When the user clicks "Edit" on a saved segment, swap definition in.
  useEffect(() => {
    setDefinition(
      initialDefinition ? normaliseSegmentDefinition(initialDefinition) : { match: 'all', filters: [] },
    )
  }, [editingSegmentId, initialDefinition])

  // Debounced live count via count_segment RPC.
  useEffect(() => {
    let cancelled = false
    setCounting(true)
    setCountError(null)
    const handle = setTimeout(async () => {
      try {
        const supabase = createClient()
        const { data, error } = await supabase
          .rpc('marketing_count_segment', { p_definition: definition })
        if (cancelled) return
        if (error) throw error
        setCount(typeof data === 'number' ? data : Number(data ?? 0))
      } catch (e) {
        if (!cancelled) {
          setCountError(e instanceof Error ? e.message : String(e))
          setCount(null)
        }
      } finally {
        if (!cancelled) setCounting(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [definition])

  const updateFilter = (index: number, next: SegmentFilter) => {
    setDefinition((d) => ({
      ...d,
      filters: d.filters.map((f, i) => (i === index ? next : f)),
    }))
  }
  const removeFilter = (index: number) => {
    setDefinition((d) => ({ ...d, filters: d.filters.filter((_, i) => i !== index) }))
  }
  const addFilter = (type: FilterType) => {
    setDefinition((d) => ({ ...d, filters: [...d.filters, defaultFilterFor(type, campaigns)] }))
  }

  const editing = editingSegmentId != null

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-xl">
      <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">
            {editing ? `Editing: ${editingSegmentName ?? 'segment'}` : 'Build a segment'}
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Add filters below. The count updates live.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editing && (
            <button
              onClick={onCancelEdit}
              className="text-xs text-zinc-400 hover:text-white px-3 py-2 rounded-md border border-zinc-800 hover:border-zinc-700 transition-colors"
            >
              Cancel edit
            </button>
          )}
          <button
            onClick={() => setSaveOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] transition-colors"
          >
            <Save size={14} />
            {editing ? 'Save changes' : 'Save segment'}
          </button>
        </div>
      </div>

      {/* Filter rows */}
      <div className="p-5 space-y-3">
        {/* Match mode toggle — only shown when ≥2 filters because it's a no-op otherwise */}
        {definition.filters.length >= 2 && (
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-zinc-500">Match</span>
            <div className="inline-flex rounded-md border border-zinc-800 overflow-hidden text-xs">
              <button
                onClick={() => setDefinition((d) => ({ ...d, match: 'all' }))}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  (definition.match ?? 'all') === 'all'
                    ? 'bg-[#3B9EE8] text-white'
                    : 'bg-zinc-950 text-zinc-400 hover:text-white'
                }`}
              >
                All (AND)
              </button>
              <button
                onClick={() => setDefinition((d) => ({ ...d, match: 'any' }))}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  definition.match === 'any'
                    ? 'bg-[#3B9EE8] text-white'
                    : 'bg-zinc-950 text-zinc-400 hover:text-white'
                }`}
              >
                Any (OR)
              </button>
            </div>
            <span className="text-xs text-zinc-600">of these filters</span>
          </div>
        )}

        {definition.filters.length === 0 && (
          <div className="text-xs text-zinc-500 bg-zinc-950/60 border border-dashed border-zinc-800 rounded-md px-4 py-6 text-center">
            No filters yet — count below shows everyone (23,068). Add a filter to narrow down.
          </div>
        )}

        {definition.filters.map((f, i) => (
          <FilterRow
            key={i}
            filter={f}
            campaigns={campaigns}
            onChange={(next) => updateFilter(i, next)}
            onRemove={() => removeFilter(i)}
          />
        ))}

        <AddFilterButton onAdd={addFilter} />
      </div>

      {/* Live count footer */}
      <div className="px-5 py-4 border-t border-zinc-800 bg-zinc-950/40 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users size={18} className="text-zinc-500" strokeWidth={1.75} />
          <div>
            <p className="text-2xl font-bold tabular-nums text-white">
              {counting ? '…' : fmt(count)}
            </p>
            <p className="text-[11px] text-zinc-500">
              {counting ? 'counting…' : 'contacts match'}
            </p>
          </div>
        </div>
        {countError && (
          <p className="text-xs text-red-400 max-w-md truncate" title={countError}>
            count failed: {countError}
          </p>
        )}
      </div>

      {saveOpen && (
        <SaveSegmentModal
          definition={definition}
          initialName={editingSegmentName ?? ''}
          initialDescription={editingSegmentDescription ?? ''}
          editingSegmentId={editingSegmentId ?? null}
          onClose={() => setSaveOpen(false)}
          onSaved={() => {
            setSaveOpen(false)
            onSaved()
          }}
        />
      )}
    </section>
  )
}

function AddFilterButton({ onAdd }: { onAdd: (t: FilterType) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md bg-zinc-950 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700 transition-colors"
      >
        <Plus size={14} />
        Add filter
      </button>
      {open && (
        <div
          className="absolute left-0 mt-1.5 z-20 w-64 bg-zinc-900 border border-zinc-800 rounded-md shadow-xl overflow-hidden"
          onMouseLeave={() => setOpen(false)}
        >
          {FILTER_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onAdd(opt.value)
                setOpen(false)
              }}
              className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:text-white hover:bg-zinc-800/80 transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FilterRow({
  filter,
  campaigns,
  onChange,
  onRemove,
}: {
  filter: SegmentFilter
  campaigns: CampaignLite[]
  onChange: (next: SegmentFilter) => void
  onRemove: () => void
}) {
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2.5 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <FilterInputs filter={filter} campaigns={campaigns} onChange={onChange} />
      </div>
      <button
        onClick={onRemove}
        aria-label="Remove filter"
        className="text-zinc-500 hover:text-red-400 transition-colors shrink-0 mt-1"
      >
        <X size={14} />
      </button>
    </div>
  )
}

function FilterInputs({
  filter,
  campaigns,
  onChange,
}: {
  filter: SegmentFilter
  campaigns: CampaignLite[]
  onChange: (next: SegmentFilter) => void
}) {
  switch (filter.type) {
    case 'campaign_engagement':
      return <CampaignEngagementFilter filter={filter} campaigns={campaigns} onChange={onChange} />

    case 'consent':
      return (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Consent</span>
          <select
            value={filter.consented ? 'yes' : 'no'}
            onChange={(e) => onChange({ ...filter, consented: e.target.value === 'yes' })}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600"
          >
            <option value="yes">Consented</option>
            <option value="no">Not consented</option>
          </select>
        </div>
      )
    case 'total_spend_gte':
    case 'total_spend_lte':
      return (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">
            {filter.type === 'total_spend_gte' ? 'Total spend ≥' : 'Total spend ≤'}
          </span>
          <span className="text-zinc-400">£</span>
          <input
            type="number"
            min={0}
            step={1}
            value={filter.value_pence / 100}
            onChange={(e) => {
              const pounds = parseFloat(e.target.value)
              const pence = Number.isFinite(pounds) ? Math.round(pounds * 100) : 0
              onChange({ ...filter, value_pence: pence })
            }}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 w-28 tabular-nums"
          />
        </div>
      )
    case 'total_orders_gte':
    case 'total_orders_lte':
      return (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">
            {filter.type === 'total_orders_gte' ? 'Total orders ≥' : 'Total orders ≤'}
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={filter.value}
            onChange={(e) => onChange({ ...filter, value: parseInt(e.target.value, 10) || 0 })}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 w-20 tabular-nums"
          />
        </div>
      )
    case 'signed_up_after':
    case 'signed_up_before':
      return (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">
            {filter.type === 'signed_up_after' ? 'Signed up after' : 'Signed up before'}
          </span>
          <input
            type="date"
            value={filter.date}
            onChange={(e) => onChange({ ...filter, date: e.target.value })}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600"
          />
        </div>
      )
    case 'country_in':
      return <CountryPicker filter={filter} onChange={onChange} />
    case 'is_test':
      return (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Test contacts</span>
          <select
            value={filter.value ? 'only' : 'exclude'}
            onChange={(e) => onChange({ ...filter, value: e.target.value === 'only' })}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600"
          >
            <option value="only">Only test contacts</option>
            <option value="exclude">Exclude test contacts</option>
          </select>
          <span className="text-zinc-600 text-[10px] italic">
            without this filter, test contacts are gated out automatically
          </span>
        </div>
      )
  }
}

function CampaignEngagementFilter({
  filter,
  campaigns,
  onChange,
}: {
  filter: Extract<SegmentFilter, { type: 'campaign_engagement' }>
  campaigns: CampaignLite[]
  onChange: (next: SegmentFilter) => void
}) {
  const selected = useMemo(() => new Set(filter.campaign_ids), [filter.campaign_ids])
  const toggle = (id: number) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({ ...filter, campaign_ids: Array.from(next) })
  }
  const clearAll = () => onChange({ ...filter, campaign_ids: [] })
  const selectAll = () => onChange({ ...filter, campaign_ids: campaigns.map((c) => c.id) })

  const empty = filter.campaign_ids.length === 0
  const totalPicked = filter.campaign_ids.length

  return (
    <div className="flex flex-col gap-2.5">
      {/* Row 1: role — the primary question ("has this contact backed / signed up / not backed") */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-500 shrink-0">Contact who</span>
        <select
          value={filter.role}
          onChange={(e) => onChange({ ...filter, role: e.target.value as CampaignEngagementRole })}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 min-w-[180px]"
        >
          {(Object.keys(ROLE_LABELS) as CampaignEngagementRole[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <span className="text-zinc-500">on</span>
        <span className="text-zinc-300">
          {empty ? (
            <span className="text-amber-400">no campaigns yet</span>
          ) : totalPicked === 1 ? (
            <span>1 campaign</span>
          ) : (
            <span>{totalPicked} campaigns</span>
          )}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={selectAll}
            className="text-[10px] uppercase tracking-wide text-zinc-500 hover:text-white transition-colors"
          >
            Select all
          </button>
          <span className="text-zinc-700">·</span>
          <button
            type="button"
            onClick={clearAll}
            disabled={empty}
            className="text-[10px] uppercase tracking-wide text-zinc-500 hover:text-white transition-colors disabled:opacity-40"
          >
            Clear
          </button>
        </span>
      </div>

      {/* Row 2: campaign multi-select. Chip-style toggle grid — matches the CountryPicker pattern. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
        {campaigns.map((c) => {
          const on = selected.has(c.id)
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className={`text-left px-2.5 py-1.5 rounded text-[11px] transition-colors truncate ${
                on
                  ? 'bg-[#3B9EE8] text-white'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-white hover:border-zinc-700'
              }`}
              title={c.name}
            >
              {c.name}
            </button>
          )
        })}
      </div>

      {empty && (
        <p className="text-[11px] text-amber-400/80 flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
          Pick at least one campaign — until then this filter is ignored.
        </p>
      )}
    </div>
  )
}

function CountryPicker({
  filter,
  onChange,
}: {
  filter: Extract<SegmentFilter, { type: 'country_in' }>
  onChange: (next: SegmentFilter) => void
}) {
  const selected = useMemo(() => new Set(filter.codes), [filter.codes])
  const toggle = (code: string) => {
    const next = new Set(selected)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    onChange({ ...filter, codes: Array.from(next) })
  }
  return (
    <div className="text-xs">
      <p className="text-zinc-500 mb-1.5">Country in</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5">
        {COUNTRY_OPTIONS.map((c) => {
          const on = selected.has(c.code)
          return (
            <button
              key={c.code}
              onClick={() => toggle(c.code)}
              className={`text-left px-2 py-1 rounded text-[11px] transition-colors ${
                on
                  ? 'bg-[#3B9EE8] text-white'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-white hover:border-zinc-700'
              }`}
            >
              <span className="font-mono mr-1">{c.code}</span>
              <span className="opacity-70">{c.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SaveSegmentModal({
  definition,
  initialName,
  initialDescription,
  editingSegmentId,
  onClose,
  onSaved,
}: {
  definition: SegmentDefinition
  initialName: string
  initialDescription: string
  editingSegmentId: number | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .rpc('marketing_upsert_segment', {
          p_name: name.trim(),
          p_description: description.trim() || null,
          p_definition: definition,
          p_id: editingSegmentId,
        })
      if (error) throw error
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-white">
            {editingSegmentId ? 'Save changes' : 'Save segment'}
          </h3>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Thing backers, not yet Aliens"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-600"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-600 resize-none"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-2 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] disabled:opacity-50 transition-colors"
          >
            <Save size={14} />
            {saving ? 'Saving…' : editingSegmentId ? 'Save changes' : 'Save segment'}
          </button>
        </div>
      </div>
    </div>
  )
}
