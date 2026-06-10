'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useAuth } from '@/components/AuthProvider'
import type { Role } from '@/lib/auth'
import { UserPlus, Trash2 } from 'lucide-react'

export type UserRow = {
  user_id: string
  email: string
  display_name: string | null
  role: Role | null
  invited_at: string | null
  confirmed_at: string | null
  last_sign_in_at: string | null
  user_created_at: string
  role_assigned_at: string | null
}

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  team: 'Team',
  support: 'Support',
}

const ROLE_TONE: Record<Role, { bg: string; text: string; border: string }> = {
  admin: { bg: 'bg-emerald-950', text: 'text-emerald-300', border: 'border-emerald-900/60' },
  team: { bg: 'bg-sky-950', text: 'text-sky-300', border: 'border-sky-900/60' },
  support: { bg: 'bg-zinc-900', text: 'text-zinc-400', border: 'border-zinc-800' },
}

// Pretty-print activity timestamps. The Auth admin view uses these to
// signal whether an invited user has actually claimed the account.
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Pull a friendly message out of an Edge Function invoke error. The
// Supabase JS client wraps non-2xx into a FunctionsHttpError whose
// `.context.body` is the raw response — usually JSON with `{ error }`.
async function extractEdgeError(err: unknown): Promise<string> {
  if (typeof err !== 'object' || err === null) return String(err)
  // deno-lint-ignore no-explicit-any
  const e = err as any
  if (e.context?.body && typeof e.context.body === 'string') {
    try {
      const parsed = JSON.parse(e.context.body)
      if (parsed?.error) return String(parsed.error)
    } catch {}
  }
  // Newer SDKs hand back a Response in context — read once and parse.
  if (e.context instanceof Response) {
    try {
      const txt = await e.context.clone().text()
      try {
        const parsed = JSON.parse(txt)
        if (parsed?.error) return String(parsed.error)
      } catch {
        if (txt) return txt
      }
    } catch {}
  }
  return e.message ?? 'unknown error'
}

export default function UsersList({ initialUsers }: { initialUsers: UserRow[] }) {
  const { user: currentUser } = useAuth()
  const supabase = createClient()
  const [users, setUsers] = useState<UserRow[]>(initialUsers)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)

  async function changeRole(user_id: string, role: Role) {
    setPendingId(user_id)
    setError(null)
    const { error: e } = await supabase.rpc('admin_set_user_role', {
      p_user_id: user_id,
      p_role: role,
    })
    setPendingId(null)
    if (e) {
      setError(e.message)
      return
    }
    setUsers((prev) =>
      prev.map((u) =>
        u.user_id === user_id
          ? { ...u, role, role_assigned_at: new Date().toISOString() }
          : u,
      ),
    )
  }

  async function changeDisplayName(user_id: string, display_name: string) {
    setPendingId(user_id)
    setError(null)
    const next = display_name.trim()
    const { error: e } = await supabase.rpc('admin_set_display_name', {
      p_user_id: user_id,
      p_display_name: next || null,
    })
    setPendingId(null)
    if (e) {
      setError(e.message)
      return
    }
    setUsers((prev) =>
      prev.map((u) =>
        u.user_id === user_id ? { ...u, display_name: next || null } : u,
      ),
    )
  }

  async function revoke(user_id: string, email: string) {
    if (
      !confirm(
        `Revoke ${email}? They can still sign in but will lose all role access (falls back to support).`,
      )
    ) {
      return
    }
    setPendingId(user_id)
    setError(null)
    const { error: e } = await supabase.rpc('admin_revoke_user_role', { p_user_id: user_id })
    setPendingId(null)
    if (e) {
      setError(e.message)
      return
    }
    setUsers((prev) =>
      prev.map((u) =>
        u.user_id === user_id ? { ...u, role: null, role_assigned_at: null } : u,
      ),
    )
  }

  async function invite(email: string, role: Role, displayName: string) {
    setPendingId('__invite__')
    setError(null)
    // The redirect URL gets baked into the magic-link email — so it
    // has to point at the recipient's reachable app, NOT the inviter's
    // current origin. Using window.location.origin meant an invite
    // sent while running `npm run dev` shipped the user a link to
    // *their* localhost:3000, which (rightly) refuses to connect.
    // Hardcoded prod URL by default; NEXT_PUBLIC_APP_URL lets a dev
    // override for staging tests.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://creator-vc-os.vercel.app'
    const { data, error: e } = await supabase.functions.invoke<{
      user_id: string
      email: string
      role: Role
      display_name: string | null
    }>('admin-invite-user', {
      body: {
        email,
        role,
        displayName: displayName.trim() || null,
        // Send the magic link back to /login. Once signed in middleware
        // pushes them to their first-allowed screen.
        redirectTo: `${appUrl}/login`,
      },
    })
    setPendingId(null)
    if (e) {
      setError(await extractEdgeError(e))
      return
    }
    if (!data) {
      setError('Invite failed (no response)')
      return
    }
    // Add to the top so it's obvious the row appeared.
    setUsers((prev) => [
      {
        user_id: data.user_id,
        email: data.email,
        display_name: data.display_name,
        role: data.role,
        invited_at: new Date().toISOString(),
        confirmed_at: null,
        last_sign_in_at: null,
        user_created_at: new Date().toISOString(),
        role_assigned_at: new Date().toISOString(),
      },
      ...prev,
    ])
    setShowInvite(false)
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          Roles control which screens each user can see. Revoking removes their
          role row but keeps their login alive.
        </p>
        <button
          type="button"
          onClick={() => {
            setShowInvite(true)
            setError(null)
          }}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#3B9EE8] hover:bg-[#3691d4] text-white text-sm font-medium transition-colors"
        >
          <UserPlus size={15} strokeWidth={2} />
          Invite user
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-950 border border-red-900/60 text-sm text-red-300">
          {error}
        </div>
      )}

      {showInvite && (
        <InviteForm
          onCancel={() => setShowInvite(false)}
          onSubmit={invite}
          pending={pendingId === '__invite__'}
        />
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Name</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Email</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Role</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Last sign-in</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-zinc-500">Joined</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-zinc-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = currentUser?.id === u.user_id
              const busy = pendingId === u.user_id
              return (
                <tr
                  key={u.user_id}
                  className={`border-b border-zinc-800/50 last:border-0 ${busy ? 'opacity-40' : ''}`}
                >
                  <td className="px-6 py-4">
                    <DisplayNameCell
                      value={u.display_name}
                      disabled={busy}
                      onSave={(next) => changeDisplayName(u.user_id, next)}
                    />
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-zinc-300">{u.email}</span>
                    {isSelf && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-zinc-500 bg-zinc-800/80 px-1.5 py-0.5 rounded">
                        you
                      </span>
                    )}
                    {!u.confirmed_at && u.invited_at && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-400 bg-amber-950 border border-amber-900/60 px-1.5 py-0.5 rounded">
                        Invited
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <select
                      value={u.role ?? ''}
                      disabled={busy || isSelf}
                      onChange={(e) => {
                        const next = e.target.value as Role
                        if (next) void changeRole(u.user_id, next)
                      }}
                      className={`bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1 text-xs text-white disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-zinc-500`}
                    >
                      <option value="" disabled>
                        — none —
                      </option>
                      <option value="admin">Admin</option>
                      <option value="team">Team</option>
                      <option value="support">Support</option>
                    </select>
                    {u.role && (
                      <span
                        className={`ml-2 inline-flex items-center text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border ${
                          ROLE_TONE[u.role].bg
                        } ${ROLE_TONE[u.role].text} ${ROLE_TONE[u.role].border}`}
                      >
                        {ROLE_LABEL[u.role]}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-zinc-400">{fmtDate(u.last_sign_in_at)}</td>
                  <td className="px-6 py-4 text-zinc-400">{fmtDate(u.user_created_at)}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="button"
                      onClick={() => void revoke(u.user_id, u.email)}
                      disabled={busy || isSelf || !u.role}
                      title={
                        isSelf
                          ? "You can't revoke your own role"
                          : !u.role
                            ? 'No role to revoke'
                            : 'Revoke role'
                      }
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-zinc-300 bg-zinc-800/60 hover:bg-red-950 hover:text-red-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Trash2 size={13} strokeWidth={1.75} />
                      Revoke
                    </button>
                  </td>
                </tr>
              )
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-zinc-500 text-sm">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function InviteForm({
  onCancel,
  onSubmit,
  pending,
}: {
  onCancel: () => void
  onSubmit: (email: string, role: Role, displayName: string) => Promise<void>
  pending: boolean
}) {
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<Role>('team')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void onSubmit(email.trim().toLowerCase(), role, displayName)
      }}
      className="mb-4 bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5 grid grid-cols-1 md:grid-cols-[1fr,1fr,160px,auto] gap-3 md:items-end"
    >
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          autoFocus
          disabled={pending}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
          placeholder="Full name (optional)"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">
          Email address
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={pending}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
          placeholder="newuser@example.com"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          disabled={pending}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 disabled:opacity-50"
        >
          <option value="admin">Admin</option>
          <option value="team">Team</option>
          <option value="support">Support</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || !email}
          className="px-4 py-2 rounded-lg bg-[#3B9EE8] hover:bg-[#3691d4] disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {pending ? 'Sending…' : 'Send invite'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// Click-to-edit display name cell. Renders the name (or a placeholder) as
// text; clicking swaps to an input that saves on blur or Enter, cancels
// on Escape. Light enough to drop into a busy table without a separate
// edit / save / cancel flow.
function DisplayNameCell({
  value,
  disabled,
  onSave,
}: {
  value: string | null
  disabled: boolean
  onSave: (next: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setDraft(value ?? '')
          setEditing(true)
        }}
        className="text-left font-medium text-white hover:text-zinc-300 disabled:opacity-50 transition-colors"
        title="Click to edit"
      >
        {value || <span className="text-zinc-600 italic font-normal">Set name…</span>}
      </button>
    )
  }

  const commit = async () => {
    const next = draft.trim()
    setEditing(false)
    if (next === (value ?? '')) return
    await onSave(next)
  }

  return (
    <input
      type="text"
      value={draft}
      autoFocus
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          void commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setEditing(false)
        }
      }}
      className="bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1 text-sm text-white focus:outline-none focus:border-zinc-500"
      placeholder="Full name"
    />
  )
}
