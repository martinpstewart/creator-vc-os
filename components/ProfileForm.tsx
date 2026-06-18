'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { formatErrorMessage } from '@/lib/format-error'
import { Check } from 'lucide-react'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  team: 'Team',
  support: 'Support',
}

// Two independent sections, each with its own submit + state so a user
// can update name without retyping their password, and vice versa.
//
// Password change uses supabase.auth.updateUser({ password }). The
// browser session is already authenticated; Supabase doesn't require
// the current password here (we trust the active session). For extra
// safety against shoulder-surfers we ask for the new password twice.
export default function ProfileForm({
  email,
  initialDisplayName,
  role,
}: {
  email: string
  initialDisplayName: string | null
  role: string | null
}) {
  const router = useRouter()
  const supabase = createClient()

  return (
    <div className="space-y-6">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 md:p-6">
        <p className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium mb-1.5">Email</p>
        <p className="text-sm text-zinc-200 font-mono">{email}</p>
        {role && (
          <>
            <p className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium mt-4 mb-1.5">Role</p>
            <p className="text-sm text-zinc-200">{ROLE_LABEL[role] ?? role}</p>
          </>
        )}
        <p className="text-[10px] text-zinc-600 mt-3">
          To change your email or role, ask an admin.
        </p>
      </div>

      <NameSection
        initial={initialDisplayName}
        onSave={async (next) => {
          const { error } = await supabase.rpc('user_set_display_name', {
            p_display_name: next || null,
          })
          if (error) throw error
          // Refresh server components that read display_name (e.g. the
          // tickets assignee dropdown picks it up from the same column).
          router.refresh()
        }}
      />

      <PasswordSection
        onSave={async (next) => {
          const { error } = await supabase.auth.updateUser({ password: next })
          if (error) throw error
        }}
      />
    </div>
  )
}

function NameSection({
  initial,
  onSave,
}: {
  initial: string | null
  onSave: (next: string) => Promise<void>
}) {
  const [value, setValue] = useState(initial ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)

  const dirty = value.trim() !== (initial ?? '').trim()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave(value.trim())
      setFlash(true)
      setTimeout(() => setFlash(false), 2000)
    } catch (e) {
      setError(formatErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 md:p-6">
      <h2 className="text-sm font-semibold text-white">Display name</h2>
      <p className="text-xs text-zinc-500 mt-1">
        Shown in ticket assignees, the users table, and anywhere else your name appears.
      </p>
      <div className="mt-4">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Martin Stewart"
          disabled={saving}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
        />
      </div>
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || !dirty}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3B9EE8] hover:bg-[#3691d4] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save name'}
        </button>
        {flash && (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
            <Check size={14} strokeWidth={2.25} />
            Saved
          </span>
        )}
      </div>
    </form>
  )
}

function PasswordSection({ onSave }: { onSave: (next: string) => Promise<void> }) {
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)

  // Supabase's minimum is 6 chars; we ask for 8 because anything shorter
  // is a footgun.
  const tooShort = next.length > 0 && next.length < 8
  const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm
  const canSubmit = next.length >= 8 && next === confirm && !saving

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave(next)
      setFlash(true)
      setNext('')
      setConfirm('')
      setTimeout(() => setFlash(false), 3000)
    } catch (e) {
      setError(formatErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 md:p-6">
      <h2 className="text-sm font-semibold text-white">Reset password</h2>
      <p className="text-xs text-zinc-500 mt-1">
        Pick a new password (at least 8 characters). You&rsquo;ll stay signed in here, but other devices will be signed out.
      </p>
      <div className="mt-4 space-y-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-zinc-500 font-medium mb-1.5">
            New password
          </label>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            disabled={saving}
            autoComplete="new-password"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 disabled:opacity-50"
          />
          {tooShort && (
            <p className="mt-1 text-[11px] text-amber-400">Must be at least 8 characters.</p>
          )}
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-zinc-500 font-medium mb-1.5">
            Confirm new password
          </label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={saving}
            autoComplete="new-password"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 disabled:opacity-50"
          />
          {mismatch && (
            <p className="mt-1 text-[11px] text-amber-400">Passwords don&rsquo;t match.</p>
          )}
        </div>
      </div>
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3B9EE8] hover:bg-[#3691d4] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          {saving ? 'Updating…' : 'Update password'}
        </button>
        {flash && (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
            <Check size={14} strokeWidth={2.25} />
            Password updated
          </span>
        )}
      </div>
    </form>
  )
}
