'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import Logo from '@/components/Logo'
import Sidebar from '@/components/Sidebar'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pathname = usePathname()

  // Close the drawer on route change so it doesn't linger after a tap.
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Mobile top bar */}
      <header className="md:hidden flex items-center justify-between bg-zinc-900 border-b border-zinc-800 px-4 py-3 sticky top-0 z-30">
        <Logo size="sm" />
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          className="p-2 -mr-2 text-zinc-300 hover:text-white"
        >
          <Menu size={22} strokeWidth={1.75} />
        </button>
      </header>

      {/* Desktop sidebar */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 flex"
          onClick={() => setDrawerOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative w-64 max-w-[80%] h-full"
            onClick={(e) => e.stopPropagation()}
          >
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <main className="flex-1 overflow-auto min-w-0">{children}</main>
    </div>
  )
}
