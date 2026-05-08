'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import Logo from './Logo'

export default function MobileTopBar() {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header
      className="md:hidden flex items-center justify-between bg-zinc-900 border-b border-zinc-800 px-4 py-3 sticky top-0 z-30"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
    >
      <Logo size="sm" />
      <button
        onClick={handleSignOut}
        aria-label="Sign out"
        className="p-2 -mr-2 text-zinc-400 hover:text-white"
      >
        <LogOut size={18} strokeWidth={1.75} />
      </button>
    </header>
  )
}
