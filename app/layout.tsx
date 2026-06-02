import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'CreatorVC',
  description: 'CreatorVC CRM',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#09090b',
}

// Inline theme bootstrap — runs before React hydrates, so the page
// paints in the right theme on first frame (no white-to-dark flash).
// Default is dark (matches the original look); users opt into light
// via the toggle next to sign-out. The script is intentionally tiny
// and synchronous so it blocks paint until the class is set.
const THEME_BOOTSTRAP = `
(function() {
  try {
    var saved = localStorage.getItem('theme');
    var theme = saved === 'light' ? 'light' : 'dark';
    if (theme === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`.trim()

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className={`${geist.className} h-full bg-zinc-950 text-white antialiased`}>
        {children}
      </body>
    </html>
  )
}
