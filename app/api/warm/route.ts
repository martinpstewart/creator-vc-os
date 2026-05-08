import { NextResponse, type NextRequest } from 'next/server'
import {
  getKPIs,
  getCampaigns,
  getCampaignStats,
  getCampaignUnitsSold,
} from '@/lib/supabase'

// Cache pre-warm endpoint, called on a Vercel cron (see vercel.json).
// Hits the cached aggregate RPCs so the next user request finds them
// already warm in Next.js's data cache instead of paying the Supabase
// round-trip.
//
// Auth: Vercel cron jobs send `Authorization: Bearer ${CRON_SECRET}`
// automatically. The same secret can be used for manual warm calls.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const started = Date.now()

  // Warm the cheap shared aggregates first.
  const stats = await getCampaignStats()
  const [, , unitsSoldResults] = await Promise.all([
    getKPIs(),
    getCampaigns(),
    // Warm per-campaign units sold for every active campaign in parallel.
    Promise.all(stats.map((c) => getCampaignUnitsSold(c.campaign_id))),
  ])

  return NextResponse.json({
    ok: true,
    warmed: {
      kpis: true,
      campaigns: true,
      campaign_stats: stats.length,
      campaign_units_sold: unitsSoldResults.length,
    },
    elapsed_ms: Date.now() - started,
  })
}
