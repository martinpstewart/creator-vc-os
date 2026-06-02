import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { withRetry } from '@/lib/supabase'
import MicrositeBuilder from '@/components/MicrositeBuilder'

export const dynamic = 'force-dynamic'

type Row = {
  id: number
  campaign_id: number
  slug: string
  title: string
  description: string | null
  status: string
  design_json: unknown
}

export default async function PageEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (Number.isNaN(id)) notFound()

  const supabase = await createClient()
  const { data, error } = await withRetry(
    async () => await supabase.rpc('marketing_get_microsite', { p_id: id }),
    'marketing_get_microsite',
  )
  if (error) throw error

  const rows = (data as Row[] | null) ?? []
  const m = rows[0]
  if (!m) notFound()

  return (
    <MicrositeBuilder
      id={m.id}
      initialTitle={m.title}
      initialDescription={m.description}
      initialSlug={m.slug}
      initialCampaignId={m.campaign_id}
      initialStatus={m.status}
      initialDesign={m.design_json}
    />
  )
}
