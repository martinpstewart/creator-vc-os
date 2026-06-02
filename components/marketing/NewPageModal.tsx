'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { X, Sparkles } from 'lucide-react'
import type { CampaignLite, LandingTemplateRow } from './types'

// Title → URL-safe slug. Matches the DB CHECK ^[a-z0-9][a-z0-9-]*$.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function NewPageModal({
  templates,
  onClose,
  onCreated,
}: {
  templates: LandingTemplateRow[]
  onClose: () => void
  onCreated: () => void
}) {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([])
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [campaignId, setCampaignId] = useState<number | ''>('')
  const [templateId, setTemplateId] = useState<number | ''>('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingCampaigns, setLoadingCampaigns] = useState(true)

  // Load campaigns once on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('get_campaigns')
        if (cancelled) return
        if (error) throw error
        type CampRow = { id: number; name: string }
        const list = ((data as CampRow[]) ?? []).map((c) => ({ id: c.id, name: c.name }))
        list.sort((a, b) => a.name.localeCompare(b.name))
        setCampaigns(list)
        if (list[0]) setCampaignId(list[0].id)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoadingCampaigns(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Auto-derive slug from title until the user manually edits it.
  useEffect(() => {
    if (slugTouched) return
    setSlug(slugify(title))
  }, [title, slugTouched])

  const slugValid = useMemo(() => /^[a-z0-9][a-z0-9-]*$/.test(slug), [slug])
  const canSubmit = !!title.trim() && slugValid && !!campaignId && !creating

  async function handleCreate() {
    if (!canSubmit) return
    setCreating(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('marketing_create_microsite', {
        p_campaign_id: campaignId,
        p_slug: slug,
        p_title: title.trim(),
        p_description: null,
        p_template_id: templateId === '' ? null : templateId,
      })
      if (error) throw error
      const newId = typeof data === 'number' ? data : Number(data)
      onCreated()
      router.push(`/marketing/pages/${newId}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Friendlier message for the per-campaign uniqueness violation.
      if (/duplicate key|unique/i.test(msg)) {
        setError(`A page with slug "${slug}" already exists for that campaign.`)
      } else {
        setError(msg)
      }
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">New landing page</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Saved as a draft — design and publish on the next screen.
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white p-1" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. The Thing Expanded — early access"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">
              Slug{' '}
              <span className="text-zinc-700">— public URL is /p/{slug || '…'}</span>
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(slugify(e.target.value))
              }}
              placeholder="the-thing-expanded"
              className={`w-full bg-zinc-950 border rounded-md px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none ${
                slug && !slugValid ? 'border-red-700 focus:border-red-600' : 'border-zinc-800 focus:border-zinc-600'
              }`}
            />
            {slug && !slugValid && (
              <p className="text-[10px] text-red-400 mt-1">
                lowercase, digits, hyphens; must start with a letter or digit
              </p>
            )}
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">Campaign</label>
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
              disabled={loadingCampaigns}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-600"
            >
              {loadingCampaigns && <option value="">Loading…</option>}
              {!loadingCampaigns &&
                campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1">
              Start from
            </label>
            <select
              value={templateId}
              onChange={(e) =>
                setTemplateId(e.target.value === '' ? '' : parseInt(e.target.value, 10))
              }
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-600"
            >
              <option value="">Blank page</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {templateId !== '' && (
              <p className="text-[10px] text-zinc-500 mt-1 inline-flex items-center gap-1">
                <Sparkles size={11} />
                We&apos;ll copy the template&apos;s design into the new page.
              </p>
            )}
          </div>

          {error && (
            <div className="bg-red-950/40 border border-red-900/60 rounded-md px-3 py-2">
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-xs text-zinc-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? 'Creating…' : 'Create draft'}
          </button>
        </div>
      </div>
    </div>
  )
}
