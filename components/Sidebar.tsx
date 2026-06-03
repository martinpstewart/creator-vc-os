'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Logo from '@/components/Logo'
import { Home, Users, Clapperboard, LogOut, Sparkles, Mail, Package, UserCog, Ticket } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { canAccess, type Screen } from '@/lib/auth'
import ThemeToggle from './ThemeToggle'

// `screen` matches the ACCESS map in lib/auth.ts — hide an entry from a
// role's nav and the middleware also blocks deep-linking to it.
//
// Order: Tickets sits under Customers (support flow), Catalogue under
// Campaigns (product/campaign flow). Ask + Users live at the bottom —
// power-user / admin surfaces below the day-to-day work.
const nav: ReadonlyArray<{
  href: string
  label: string
  Icon: typeof Home
  screen: Screen
}> = [
  { href: '/',          label: 'Dashboard', Icon: Home,         screen: 'dashboard' },
  { href: '/customers', label: 'Customers', Icon: Users,        screen: 'customers' },
  { href: '/tickets',   label: 'Tickets',   Icon: Ticket,       screen: 'tickets'   },
  { href: '/campaigns', label: 'Campaigns', Icon: Clapperboard, screen: 'campaigns' },
  { href: '/catalogue', label: 'Catalogue', Icon: Package,      screen: 'catalogue' },
  { href: '/marketing', label: 'Marketing', Icon: Mail,         screen: 'marketing' },
  { href: '/query',     label: 'Ask',       Icon: Sparkles,     screen: 'query'     },
  { href: '/users',     label: 'Users',     Icon: UserCog,      screen: 'users'     },
]

export default function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname()
  const { role, signOut } = useAuth()

  async function handleSignOut() {
    onNavigate?.()
    await signOut()
  }

  const visible = nav.filter((item) => canAccess(role, item.screen))

  return (
    <aside className="w-56 h-full shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col">
      <div className="px-5 py-5 border-b border-zinc-800">
        <Logo size="md" />
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {visible.map(({ href, label, Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm transition-colors ${
                active
                  ? 'bg-zinc-800 text-white font-medium'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
              }`}
            >
              <Icon size={15} strokeWidth={1.75} />
              {label}
            </Link>
          )
        })}
      </nav>
      <div className="px-3 py-4 border-t border-zinc-800 space-y-0.5">
        <ThemeToggle variant="full" />
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors"
        >
          <LogOut size={15} strokeWidth={1.75} />
          Sign out
        </button>
      </div>
    </aside>
  )
}
