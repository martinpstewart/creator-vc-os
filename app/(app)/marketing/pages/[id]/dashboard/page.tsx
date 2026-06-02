import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { withRetry } from '@/lib/supabase'
import PageDashboard, { type DashboardPayload } from '@/components/marketing/PageDashboard'

export const dynamic = 'force-dynamic'

export default async function PageDashboardRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (Number.isNaN(id)) notFound()

  const supabase = await createClient()
  const { data, error } = await withRetry(
    async () => await supabase.rpc('marketing_microsite_dashboard', { p_id: id }),
    'marketing_microsite_dashboard',
  )
  if (error) {
    // Postgres no_data_found surfaces as P0002 — treat as 404.
    if (error.code === 'P0002' || /not found/i.test(error.message)) notFound()
    throw error
  }
  if (!data) notFound()

  return <PageDashboard data={data as DashboardPayload} />
}
