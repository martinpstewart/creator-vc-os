'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode, MouseEvent } from 'react'

// Wraps a <tr> so the entire row navigates on click, while still
// letting nested <a> / <button> handle their own clicks (so the inner
// name link can keyboard-focus and Cmd-click into a new tab) and
// letting users select text without triggering navigation.
export default function ClickableRow({
  href,
  children,
  className = '',
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  const router = useRouter()

  function handleClick(e: MouseEvent<HTMLTableRowElement>) {
    const target = e.target as HTMLElement
    if (target.closest('a, button')) return
    if (typeof window !== 'undefined' && window.getSelection()?.toString()) return
    router.push(href)
  }

  return (
    <tr onClick={handleClick} className={`cursor-pointer ${className}`}>
      {children}
    </tr>
  )
}
