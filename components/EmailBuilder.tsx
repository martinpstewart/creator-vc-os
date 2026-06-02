'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ArrowLeft, Send, Save } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import SegmentPickerForTemplate from '@/components/marketing/SegmentPickerForTemplate'

// react-email-editor mounts an iframe and reads window — load client-only.
// The package's exported types tie generics to the specific embed runtime
// which Turbopack/strict TS doesn't always resolve cleanly, so we use a
// permissive editor type — runtime methods are the documented Unlayer ones.
// deno-lint-ignore-file
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EmailEditor = dynamic(() => import('react-email-editor'), { ssr: false }) as any

const UNLAYER_PROJECT_ID = 286722

const RECIPIENTS_STORAGE_KEY = 'creatorvc.email.recipients'

type UnlayerInstance = {
  loadDesign: (design: unknown) => void
  exportHtml: (cb: (data: { design: unknown; html: string }) => void) => void
  saveDesign: (cb: (design: unknown) => void) => void
}

type RecipientsBundle = {
  question: string
  emails: string[]
  capturedAt: string
}

export default function EmailBuilder({
  mode,
  initialId,
  initialName,
  initialSubject,
  initialDesign,
  initialSegmentId,
}: {
  mode: 'create' | 'edit'
  initialId?: number
  initialName?: string
  initialSubject?: string | null
  initialDesign?: unknown
  initialSegmentId?: number | null
}) {
  const router = useRouter()
  const editorRef = useRef<UnlayerInstance | null>(null)
  const [name, setName] = useState(initialName ?? 'Untitled template')
  const [subject, setSubject] = useState(initialSubject ?? '')
  const [segmentId, setSegmentId] = useState<number | null>(initialSegmentId ?? null)
  const [editorReady, setEditorReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recipients, setRecipients] = useState<RecipientsBundle | null>(null)
  const [showMobileNotice, setShowMobileNotice] = useState(false)

  // Recipient handoff from /query, picked up from sessionStorage.
  useEffect(() => {
    if (mode !== 'create') return
    try {
      const raw = sessionStorage.getItem(RECIPIENTS_STORAGE_KEY)
      if (!raw) return
      const bundle = JSON.parse(raw) as RecipientsBundle
      if (bundle?.emails?.length) setRecipients(bundle)
    } catch {
      // ignore — corrupt blob, just no chip
    }
  }, [mode])

  // Mobile width warning. Editor needs ≥1024px ideally.
  useEffect(() => {
    if (typeof window === 'undefined') return
    setShowMobileNotice(window.innerWidth < 1024)
  }, [])

  // When the editor reports ready, load the template's design (if any).
  useEffect(() => {
    if (!editorReady || !editorRef.current || !initialDesign) return
    try {
      editorRef.current.loadDesign(initialDesign)
    } catch (e) {
      console.error('[EmailBuilder] loadDesign failed', e)
    }
  }, [editorReady, initialDesign])

  async function handleSave() {
    if (!editorRef.current) {
      setError('Editor not ready yet')
      return
    }
    setSaving(true)
    setError(null)

    // exportHtml gives us both the design JSON + rendered HTML in one call.
    const { design, html } = await new Promise<{ design: unknown; html: string }>(
      (resolve) => editorRef.current!.exportHtml((data) => resolve(data))
    )

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      const payload = {
        name: name.trim() || 'Untitled template',
        subject: subject.trim() || null,
        design,
        html,
        segment_id: segmentId,
        created_by: user?.id ?? null,
      }

      if (mode === 'edit' && initialId) {
        const { error: upErr } = await supabase
          .from('email_templates')
          .update(payload)
          .eq('id', initialId)
        if (upErr) throw upErr
        router.refresh()
      } else {
        const { data, error: insErr } = await supabase
          .from('email_templates')
          .insert(payload)
          .select('id')
          .single()
        if (insErr) throw insErr
        // Clear the recipient handoff once the template owns the context.
        sessionStorage.removeItem(RECIPIENTS_STORAGE_KEY)
        router.replace(`/marketing/${data.id}`)
        router.refresh()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  function handleSendStub() {
    // TODO: wire to SES/Unlayer send flow when that lands. For now,
    // surface the segment + recipients + subject so the user can see we
    // captured everything.
    alert(
      `Send is not wired yet.\n\n` +
        `Template: ${name}\n` +
        `Subject: ${subject || '—'}\n` +
        `Segment: ${segmentId ?? 'none'}\n` +
        `Recipients (from /query handoff): ${recipients?.emails?.length ?? 0}`,
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      {/* Sticky header: name, subject, actions */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 md:px-6 py-3 flex flex-col md:flex-row md:items-center gap-3">
        <Link
          href="/marketing"
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
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject line (optional)"
            className="bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-md bg-zinc-800 text-zinc-100 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
          >
            <Save size={14} />
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={handleSendStub}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-md bg-[#3B9EE8] text-white hover:bg-[#2d8ed8] transition-colors"
          >
            <Send size={14} />
            Send
          </button>
        </div>
      </div>

      {/* Segment picker strip */}
      <div className="bg-zinc-900/60 border-b border-zinc-800 px-4 md:px-6 py-2">
        <SegmentPickerForTemplate value={segmentId} onChange={setSegmentId} />
      </div>

      {/* Banners */}
      {recipients && (
        <div className="bg-emerald-950/40 border-b border-emerald-900/60 px-4 py-2 text-xs text-emerald-300">
          {recipients.emails.length.toLocaleString()} recipients ready from your last query
          <span className="text-emerald-500/70"> · &quot;{recipients.question}&quot;</span>
        </div>
      )}
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
            displayMode: 'email',
            // mergeTags is an object map keyed by tag id (not an array).
            mergeTags: {
              first_name: { name: 'First name', value: '{{first_name}}' },
              last_name:  { name: 'Last name',  value: '{{last_name}}'  },
              email:      { name: 'Email',      value: '{{email}}'      },
            },
            user: {
              // Used by Unlayer for audit / collaboration metadata.
              id: 'creator-vc-team',
            },
          }}
        />
      </div>
    </div>
  )
}
