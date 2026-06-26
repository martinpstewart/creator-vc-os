'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Users, Clapperboard, Ticket, Mail, Package, Sparkles } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { canAccess, type Screen } from '@/lib/auth'

// Bottom nav mirrors the sidebar — every screen the user has access to
// shows up on mobile too. `screen` keys match lib/auth.ts so entries
// disappear automatically when a role can't access them. Users is still
// desktop-only (admin management isn't a mobile flow); everything else
// — including Ask — surfaces on small screens.
const items: ReadonlyArray<{
  href: string
  label: string
  Icon: typeof Home
  screen: Screen
}> = [
  { href: '/',          label: 'Home',      Icon: Home,         screen: 'dashboard' },
  { href: '/customers', label: 'Customers', Icon: Users,        screen: 'customers' },
  { href: '/campaigns', label: 'Campaigns', Icon: Clapperboard, screen: 'campaigns' },
  { href: '/catalogue', label: 'Catalogue', Icon: Package,      screen: 'catalogue' },
  { href: '/marketing', label: 'Marketing', Icon: Mail,         screen: 'marketing' },
  { href: '/tickets',   label: 'Tickets',   Icon: Ticket,       screen: 'tickets'   },
  { href: '/query',     label: 'Ask',       Icon: Sparkles,     screen: 'query'     },
]

export default function BottomNav() {
  const pathname = usePathname()
  const { role } = useAuth()
  const visible = items.filter((item) => canAccess(role, item.screen))

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-zinc-900/95 backdrop-blur border-t border-zinc-800 flex items-stretch"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {visible.map(({ href, label, Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors ${
              active ? 'text-[#3B9EE8]' : 'text-zinc-500 active:text-zinc-200'
            }`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={20} strokeWidth={1.75} />
            <span className="text-[10px] font-semibold tracking-wide">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
