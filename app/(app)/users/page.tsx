import { redirect } from 'next/navigation'
import { UserCog } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { withRetry } from '@/lib/supabase'
import { getCurrentRole } from '@/lib/auth-server'
import UsersList, { type UserRow } from './UsersList'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  // Defense-in-depth — middleware already redirects non-admins, but this
  // makes the server page invocation itself safe.
  const role = await getCurrentRole()
  if (role !== 'admin') redirect('/')

  const supabase = await createClient()
  const { data, error } = await withRetry(
    async () => await supabase.rpc('admin_list_users'),
    'admin_list_users',
  )
  if (error) {
    // RPC raises 42501 if somehow called by a non-admin — the redirect
    // above should make this unreachable. Surface a tiny message rather
    // than throwing into an error boundary.
    return (
      <div className="p-4 md:p-8">
        <p className="text-sm text-red-400">Failed to load users: {error.message}</p>
      </div>
    )
  }

  const users = (data ?? []) as UserRow[]

  return (
    <div className="p-4 md:p-8">
      <header className="mb-6 md:mb-8 flex items-center gap-3">
        <span className="inline-flex items-center justify-center w-9 h-9 md:w-10 md:h-10 rounded-lg bg-[#3B9EE8]">
          <UserCog size={18} className="text-white" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-white">Users</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {users.length} {users.length === 1 ? 'user' : 'users'} · admin only
          </p>
        </div>
      </header>

      <UsersList initialUsers={users} />
    </div>
  )
}
