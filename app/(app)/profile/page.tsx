import { redirect } from 'next/navigation'
import { User } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import ProfileForm from '@/components/ProfileForm'

export const dynamic = 'force-dynamic'

// Self-service profile screen. Every authenticated user can edit their
// display name (used in ticket assignee dropdowns + the users table)
// and reset their password. No role gate beyond "signed in" — the
// middleware enforces the auth check before we get here.
export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // display_name lives on app_user_roles. RLS scopes this select to the
  // caller's own row, so the .single() call is safe. password_set_at is
  // NULL for invited users who haven't completed onboarding — the page
  // then renders a "set a password first" banner and the middleware
  // funnels every other URL back here until they do.
  const { data: roleRow } = await supabase
    .schema('public')
    .from('app_user_roles')
    .select('display_name, role, password_set_at')
    .eq('user_id', user.id)
    .maybeSingle()

  const needsPassword = !roleRow?.password_set_at

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <header className="mb-6 md:mb-8 flex items-center gap-3">
        <span className="inline-flex items-center justify-center w-9 h-9 md:w-10 md:h-10 rounded-lg bg-[#3B9EE8]">
          <User size={18} className="text-white" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-white">My profile</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {needsPassword ? 'Welcome — set a password to finish setting up your account.' : 'Edit your display name and password.'}
          </p>
        </div>
      </header>

      {needsPassword && (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-sm font-semibold text-amber-200">Set a password to continue</p>
          <p className="text-xs text-amber-200/80 mt-1 leading-relaxed">
            You signed in with a magic link. Pick a password (at least 8 characters) so you can sign in directly next time. The rest of the app will unlock as soon as you save.
          </p>
        </div>
      )}

      <ProfileForm
        email={user.email ?? ''}
        initialDisplayName={roleRow?.display_name ?? null}
        role={roleRow?.role ?? null}
        needsPassword={needsPassword}
      />
    </div>
  )
}
