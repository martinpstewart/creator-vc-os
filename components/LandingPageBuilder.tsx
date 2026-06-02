'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ArrowLeft, FormInput, Save } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import FormSnippetModal from '@/components/marketing/FormSnippetModal'

// Same caveats as EmailBuilder — Unlayer mounts an iframe, must be client-only,
// and its strict TS generics don't always resolve cleanly under Turbopack.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EmailEditor = dynamic(() => import('react-email-editor'), { ssr: false }) as any

const UNLAYER_PROJECT_ID = 286722

type UnlayerInstance = {
  loadDesign: (design: unknown) => void
  exportHtml: (cb: (data: { design: unknown; html: string }) => void) => void
  saveDesign: (cb: (design: unknown) => void) => void
}

export default function LandingPageBuilder({
  mode,
  initialId,
  initialName,
  initialDescription,
  initialDesign,
}: {
  mode: 'create' | 'edit'
  initialId?: number
  initialName?: string
  initialDescription?: string | null
  initialDesign?: unknown
}) {
  const router = useRouter()
  const editorRef = useRef<UnlayerInstance | null>(null)
  const [name, setName] = useState(initialName ?? 'Untitled landing page')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [editorReady, setEditorReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showMobileNotice, setShowMobileNotice] = useState(false)
  const [showFormSnippet, setShowFormSnippet] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setShowMobileNotice(window.innerWidth < 1024)
  }, [])

  // Load the saved design once the editor is up.
  useEffect(() => {
    if (!editorReady || !editorRef.current || !initialDesign) return
    try {
      editorRef.current.loadDesign(initialDesign)
    } catch (e) {
      console.error('[LandingPageBuilder] loadDesign failed', e)
    }
  }, [editorReady, initialDesign])

  async function handleSave() {
    if (!editorRef.current) {
      setError('Editor not ready yet')
      return
    }
    setSaving(true)
    setError(null)

    const { design, html } = await new Promise<{ design: unknown; html: string }>(
      (resolve) => editorRef.current!.exportHtml((data) => resolve(data)),
    )

    try {
      const supabase = createClient()
      const args = {
        p_name: name.trim() || 'Untitled landing page',
        p_description: description.trim() || null,
        p_design: design,
        p_html: html,
        p_id: mode === 'edit' && initialId ? initialId : null,
      }
      const { data, error: upErr } = await supabase.rpc('marketing_upsert_landing_template', args)
      if (upErr) throw upErr

      if (mode === 'create') {
        const newId = typeof data === 'number' ? data : Number(data)
        if (Number.isFinite(newId)) {
          router.replace(`/marketing/landing/${newId}`)
          router.refresh()
          return
        }
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      {/* Sticky header */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 md:px-6 py-3 flex flex-col md:flex-row md:items-center gap-3">
        <Link
          href="/marketing?tab=landing"
          className="hidden md:inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors shrink-0"
        >
          <ArrowLeft size={14} /> Back
        </Link>
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name"
            className="bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFormSnippet(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-md bg-zinc-800 text-zinc-100 hover:bg-zinc-700 transition-colors"
            title="Generate a signup-form snippet to paste into Unlayer's HTML block"
          >
            <FormInput size={14} />
            Form
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] disabled:opacity-50 transition-colors"
          >
            <Save size={14} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {showFormSnippet && <FormSnippetModal onClose={() => setShowFormSnippet(false)} />}

      {/* Banners */}
      {showMobileNotice && (
        <div className="bg-amber-950/40 border-b border-amber-900/60 px-4 py-2 text-xs text-amber-300">
          The drag-and-drop editor works best on tablet or desktop.
        </div>
      )}
      {error && (
        <div className="bg-red-950/40 border-b border-red-900/60 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Editor — displayMode 'web' is Unlayer's landing-page canvas */}
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
            user: {
              id: 'creator-vc-team',
            },
          }}
        />
      </div>
    </div>
  )
}
