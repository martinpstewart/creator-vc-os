import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

// Public landing-page renderer. Bypasses auth (the whole point — these
// are pages we host for unauthenticated visitors). Returns the
// Unlayer-exported HTML as the entire response body so we never wrap
// a complete <html> document inside our CRM chrome.
//
// 404 for: unknown slug, draft, or closed microsite.

type Row = { id: number; title: string; html_cached: string }

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params

  // Stateless anon client — never read the visitor's CRM cookies here,
  // so a logged-in admin previewing a public page sees what the public
  // sees (and we don't leak admin context into a public response).
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data, error } = await supabase.rpc('marketing_get_published_microsite', { p_slug: slug })
  if (error) {
    return new NextResponse(`Lookup failed: ${error.message}`, { status: 500 })
  }
  const row = (data as Row[] | null)?.[0]
  if (!row) {
    return new NextResponse(notFoundHtml(slug), {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  return new NextResponse(row.html_cached, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Short edge cache; manual revalidate when Aaron publishes a new
      // version of the page. Tune if traffic profile changes.
      'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
    },
  })
}

function notFoundHtml(slug: string): string {
  // Minimal styled 404 — no Unlayer dependency, no CRM chrome leak.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;display:grid;place-items:center;min-height:100vh}
  .card{text-align:center;padding:2rem;max-width:28rem}
  h1{margin:0 0 .5rem;font-size:1.5rem}
  p{margin:0;color:#888}
  code{background:#1a1a1a;padding:.1rem .35rem;border-radius:.25rem;font-size:.85rem}
</style></head><body>
<div class="card"><h1>Page not found</h1>
<p>The page <code>/p/${escapeHtml(slug)}</code> isn't published.</p></div></body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
