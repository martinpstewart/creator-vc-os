'use client'

import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

// Theme state lives on <html>.classList + localStorage. The inline
// bootstrap script in app/layout.tsx applies it before paint; this
// component just reflects the current state and toggles it on click.
//
// Two flavours: a full pill button (desktop sidebar, label inline)
// and an icon-only button (mobile top bar, alongside sign-out).

type Theme = 'light' | 'dark'

function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function applyTheme(next: Theme) {
  const root = document.documentElement
  if (next === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
  try {
    localStorage.setItem('theme', next)
  } catch {
    // localStorage can throw in private mode — ignore.
  }
}

export default function ThemeToggle({
  variant = 'full',
  className = '',
}: {
  variant?: 'full' | 'icon'
  className?: string
}) {
  // Start with a deterministic value to avoid SSR hydration mismatch.
  // We don't know the real theme until the client mounts (the inline
  // script runs after SSR), so we render a placeholder on first paint
  // and swap to the real icon in useEffect.
  const [theme, setTheme] = useState<Theme | null>(null)

  useEffect(() => {
    setTheme(currentTheme())
  }, [])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }

  // Until the effect runs we don't know which icon to show — render
  // an empty button of the right shape so layout doesn't jump.
  const Icon = theme === 'light' ? Moon : Sun
  const label = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        title={label}
        className={`p-2 -mr-2 text-zinc-400 hover:text-white ${className}`}
      >
        {theme !== null ? <Icon size={18} strokeWidth={1.75} /> : <span className="block w-[18px] h-[18px]" />}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors ${className}`}
    >
      {theme !== null ? <Icon size={15} strokeWidth={1.75} /> : <span className="block w-[15px] h-[15px]" />}
      {theme === 'light' ? 'Dark mode' : 'Light mode'}
    </button>
  )
}
