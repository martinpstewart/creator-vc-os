'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
  ArrowLeft,
  ExternalLink,
  FormInput,
  RefreshCw,
  Rocket,
  Save,
  XOctagon,
} from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import FormSnippetModal from '@/components/marketing/FormSnippetModal'
import { micrositeStatusTone, type CampaignLite, type MicrositeStatus } from '@/components/marketing/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EmailEditor = dynamic(() => import('react-email-editor'), { ssr: false }) as any

const UNLAYER_PROJECT_ID = 286722

type UnlayerInstance = {
  loadDesign: (design: unknown) => void
  exportHtml: (cb: (data: { design: unknown; html: string }) => void) => void
  saveDesign: (cb: (design: unknown) => void) => void
}

export default function MicrositeBuilder({
  id,
  initialTitle,
  initialDescription,
  initialSlug,
  initialCampaignId,
  initialStatus,
  initialDesign,
}: {
  id: number
  initialTitle: string
  initialDescription: string | null
  initialSlug: string
  initialCampaignId: number
  initialStatus: MicrositeStatus | string
  initialDesign: unknown
}) {
  const router = useRouter()
  const editorRef = useRef<UnlayerInstance | null>(null)
  const [editorReady, setEditorReady] = useState(false)

  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription ?? '')
  const [slug, setSlug] = useState(initialSlug)
  const [campaignId, setCampaignId] = useState<number>(initialCampaignId)
  const [status, setStatus] = useState<string>(initialStatus)

  const [campaigns, setCampaigns] = useState<CampaignLite[]>([])
  const [busy, setBusy] = useState<null | 'save' | 'publish' | 'close' | 'reopen'>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [showMobileNotice, setShowMobileNotice] = useState(false)
  const [showFormSnippet, setShowFormSnippet] = useState(false)

  // Campaigns for the dropdown.
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
      } catch (e) {
        if (!cancelled) console.error('[MicrositeBuilder] campaigns load', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    setShowMobileNotice(window.innerWidth < 1024)
  }, [])

  // Load existing design once Unlayer is up.
  useEffect(() => {
    if (!editorReady || !editorRef.current || !initialDesign) return
    try {
      editorRef.current.loadDesign(initialDesign)
    } catch (e) {
      console.error('[MicrositeBuilder] loadDesign failed', e)
    }
  }, [editorReady, initialDesign])

  // Exports current HTML+design from Unlayer.
  function exportFromEditor(): Promise<{ design: unknown; html: string }> {
    return new Promise((resolve, reject) => {
      if (!editorRef.current) {
        reject(new Error('Editor not ready'))
        return
      }
      editorRef.current.exportHtml((data) => resolve(data))
    })
  }

  async function callSave(): Promise<void> {
    const { design, html } = await exportFromEditor()
    const supabase = createClient()
    const { error } = await supabase.rpc('marketing_upsert_microsite', {
      p_id: id,
      p_title: title.trim() || 'Untitled',
      p_description: description.trim() || null,
      p_slug: slug,
      p_design: design,
      p_html: html,
      p_campaign_id: campaignId,
    })
    if (error) throw error
  }

  async function handleSave() {
    setBusy('save')
    setError(null)
    setInfo(null)
    try {
      await callSave()
      setInfo('Saved.')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function setStatusAndSave(target: 'live' | 'closed' | 'draft') {
    setBusy(target === 'live' ? 'publish' : target === 'closed' ? 'close' : 'reopen')
    setError(null)
    setInfo(null)
    try {
      // Always save first so the latest HTML is in html_cached before the
      // live gate checks for it.
      await callSave()
      const supabase = createClient()
      const { error } = await supabase.rpc('marketing_set_microsite_status', {
        p_id: id,
        p_status: target,
      })
      if (error) throw error
      setStatus(target)
      setInfo(
        target === 'live'
          ? 'Live. Public URL is /p/' + slug + '.'
          : target === 'closed'
            ? 'Closed. The public URL now returns 404.'
            : 'Reopened as draft.',
      )
      router.refresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/unique/i.test(msg)) {
        setError('Another page is already live on this slug. Close it first, or change the slug here.')
      } else {
        setError(msg)
      }
    } finally {
      setBusy(null)
    }
  }

  const tone = micrositeStatusTone(status)
  const publicUrl = `/p/${slug}`

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      {/* Header row 1 — back, title, slug, save */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 md:px-6 py-3 flex flex-col md:flex-row md:items-center gap-3">
        <Link
          href="/marketing?tab=landing&sub=pages"
          className="hidden md:inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors shrink-0"
        >
          <ArrowLeft size={14} /> Back
        </Link>
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Page title"
            className="bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
          />
          <input
            type="text"
            value={slug}
            onChange={(e) =>
              setSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9-]+/g, '-')
                  .replace(/-+/g, '-'),
              )
            }
            placeholder="slug"
            className="bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 font-mono"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFormSnippet(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-md bg-zinc-800 text-zinc-100 hover:bg-zinc-700 transition-colors"
            title="Generate a signup-form snippet to paste in"
          >
            <FormInput size={14} />
            Form
          </button>
          <button
            onClick={handleSave}
            disabled={busy != null}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] disabled:opacity-50 transition-colors"
          >
            <Save size={14} />
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Header row 2 — status strip */}
      <div className="bg-zinc-900/60 border-b border-zinc-800 px-4 md:px-6 py-2 flex flex-wrap items-center gap-3 text-xs">
        <span
          className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold border ${tone.bg} ${tone.text} ${tone.border}`}
        >
          {tone.label}
        </span>

        <select
          value={campaignId}
          onChange={(e) => setCampaignId(parseInt(e.target.value, 10))}
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600"
        >
          {campaigns.length === 0 && <option value={campaignId}>Loading campaigns…</option>}
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="flex-1 min-w-[200px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
        />

        {/* Status action — varies by current state */}
        {status === 'draft' && (
          <button
            onClick={() => setStatusAndSave('live')}
            disabled={busy != null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white font-semibold disabled:opacity-50 transition-colors"
          >
            <Rocket size={12} />
            {busy === 'publish' ? 'Publishing…' : 'Publish'}
          </button>
        )}
        {status === 'live' && (
          <button
            onClick={() => setStatusAndSave('closed')}
            disabled={busy != null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold disabled:opacity-50 transition-colors"
          >
            <XOctagon size={12} />
            {busy === 'close' ? 'Closing…' : 'Close'}
          </button>
        )}
        {status === 'closed' && (
          <button
            onClick={() => setStatusAndSave('draft')}
            disabled={busy != null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={12} />
            {busy === 'reopen' ? 'Reopening…' : 'Reopen as draft'}
          </button>
        )}

        {/* Public URL preview / link when live */}
        {status === 'live' ? (
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[#3B9EE8] hover:underline font-mono"
          >
            {publicUrl} <ExternalLink size={11} />
          </a>
        ) : (
          <span className="text-zinc-600 font-mono">
            {publicUrl} <span className="not-italic">(not live)</span>
          </span>
        )}
      </div>

      {/* Banners */}
      {showMobileNotice && (
        <div className="bg-amber-950/40 border-b border-amber-900/60 px-4 py-2 text-xs text-amber-300">
          The drag-and-drop editor works best on tablet or desktop.
        </div>
      )}
      {error && (
        <div className="bg-red-950/40 border-b border-red-900/60 px-4 py-2 text-xs text-red-300">{error}</div>
      )}
      {info && !error && (
        <div className="bg-emerald-950/40 border-b border-emerald-900/60 px-4 py-2 text-xs text-emerald-300">
          {info}
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 min-h-0 bg-white">
        <EmailEditor
          minHeight="100%"
          projectId={UNLAYER_PROJECT_ID}
          onReady={(unlayer: UnlayerInstance) => {
            editorRef.current = unlayer
            setEditorReady(true)
          }}
          options={{
            displayMode: 'web',
            user: { id: 'creator-vc-team' },
          }}
        />
      </div>

      {showFormSnippet && <FormSnippetModal onClose={() => setShowFormSnippet(false)} />}
    </div>
  )
}
