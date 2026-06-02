'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Eye, Users, Clapperboard, Ticket, Mail } from 'lucide-react'
import { useAuth } from './AuthProvider'
import { canAccess, type Screen } from '@/lib/auth'

// Bottom nav stays at five entries max for thumb reach. `screen` keys
// match lib/auth.ts so items disappear automatically for restricted roles.
// Tickets bumps Ask off mobile — Ask is desktop-power-user UX and Tickets
// is core staff workflow; admin still sees 5, team / support fewer.
const items: ReadonlyArray<{
  href: string
  label: string
  Icon: typeof Eye
  screen: Screen
}> = [
  { href: '/', label: 'Home', Icon: Eye, screen: 'dashboard' },
  { href: '/customers', label: 'People', Icon: Users, screen: 'customers' },
  { href: '/campaigns', label: 'Campaigns', Icon: Clapperboard, screen: 'campaigns' },
  { href: '/tickets', label: 'Tickets', Icon: Ticket, screen: 'tickets' },
  { href: '/marketing', label: 'Marketing', Icon: Mail, screen: 'marketing' },
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
