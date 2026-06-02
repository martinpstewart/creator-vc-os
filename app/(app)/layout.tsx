import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { AuthProvider } from '@/components/AuthProvider'
import { createClient } from '@/lib/supabase-server'
import { withRetry } from '@/lib/supabase'
import { getCurrentRole } from '@/lib/auth-server'

// Layout is dynamic — it reads cookies + the user's role row on every
// request so nav state is never stale.
export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Runs on every (app)/* request so any transient blip here cascades into
  // every page. withRetry catches the brief Vercel↔Supabase TLS / DNS /
  // PostgREST 5xx blips that were intermittently surfacing the error
  // boundary across the app.
  const user = await withRetry(async () => {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user
  }, 'AppLayout.getUser')

  // Belt-and-braces — middleware already bounces unauthenticated requests,
  // but if it's somehow skipped (matcher miss, edge bypass) we still avoid
  // rendering app chrome without a user.
  if (!user) redirect('/login')

  // Cached per-request + retried internally — server components on the
  // same page that need the role (campaign pages gating revenue) reuse
  // this hit.
  const role = await getCurrentRole()

  return (
    <AuthProvider initialUser={user} initialRole={role}>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  )
}
