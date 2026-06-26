'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Logo from '@/components/Logo'
import { Home, Users, Clapperboard, LogOut, Sparkles, Mail, Package, UserCog, Ticket, Settings, User } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { canAccess, isOwner, type Screen } from '@/lib/auth'
import ThemeToggle from './ThemeToggle'

// `screen` matches the ACCESS map in lib/auth.ts — hide an entry from a
// role's nav and the middleware also blocks deep-linking to it.
//
// Order: Customers → Campaigns / Catalogue (product flow) → Marketing,
// then Tickets sits just above Ask so support + power-user surfaces
// cluster together at the bottom of the day-to-day list.
const nav: ReadonlyArray<{
  href: string
  label: string
  Icon: typeof Home
  screen: Screen
}> = [
  { href: '/',          label: 'Dashboard', Icon: Home,         screen: 'dashboard' },
  { href: '/customers', label: 'Customers', Icon: Users,        screen: 'customers' },
  { href: '/campaigns', label: 'Campaigns', Icon: Clapperboard, screen: 'campaigns' },
  { href: '/catalogue', label: 'Catalogue', Icon: Package,      screen: 'catalogue' },
  { href: '/marketing', label: 'Marketing', Icon: Mail,         screen: 'marketing' },
  { href: '/tickets',   label: 'Tickets',   Icon: Ticket,       screen: 'tickets'   },
  { href: '/query',     label: 'Ask',       Icon: Sparkles,     screen: 'query'     },
  { href: '/users',     label: 'Users',     Icon: UserCog,      screen: 'users'     },
  { href: '/settings',  label: 'Settings',  Icon: Settings,     screen: 'settings'  },
]

export default function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname()
  const { role, signOut, user } = useAuth()

  async function handleSignOut() {
    onNavigate?.()
    await signOut()
  }

  // Two-stage filter: role gate (canAccess) plus the owner check for
  // Martin-only screens. Settings is the only owner-scoped entry today,
  // so a single guard covers it; if more get added later, switch this
  // to a Set / metadata table.
  const ownerEmail = isOwner(user?.email)
  const visible = nav.filter(
    (item) => canAccess(role, item.screen) && (item.screen !== 'settings' || ownerEmail),
  )

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
        <Link
          href="/profile"
          onClick={onNavigate}
          className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm transition-colors ${
            pathname === '/profile'
              ? 'bg-zinc-800 text-white font-medium'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
          }`}
        >
          <User size={15} strokeWidth={1.75} />
          My profile
        </Link>
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
