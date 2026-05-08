'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Eye, Users, Clapperboard, Sparkles } from 'lucide-react'

const items = [
  { href: '/', label: 'Home', Icon: Eye },
  { href: '/customers', label: 'Customers', Icon: Users },
  { href: '/campaigns', label: 'Campaigns', Icon: Clapperboard },
  { href: '/query', label: 'Ask', Icon: Sparkles },
]

export default function BottomNav() {
  const pathname = usePathname()
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-zinc-900/95 backdrop-blur border-t border-zinc-800 flex items-stretch"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map(({ href, label, Icon }) => {
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
