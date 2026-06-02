import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { withRetry } from '@/lib/supabase'
import LandingPageBuilder from '@/components/LandingPageBuilder'

export const dynamic = 'force-dynamic'

type Row = {
  id: number
  name: string
  description: string | null
  design: unknown
}

export default async function LandingTemplateEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (Number.isNaN(id)) notFound()

  const supabase = await createClient()
  const { data, error } = await withRetry(
    async () => await supabase.rpc('marketing_get_landing_template', { p_id: id }),
    'marketing_get_landing_template',
  )
  if (error) throw error

  const rows = (data as Row[] | null) ?? []
  const tpl = rows[0]
  if (!tpl) notFound()

  return (
    <LandingPageBuilder
      mode="edit"
      initialId={tpl.id}
      initialName={tpl.name}
      initialDescription={tpl.description}
      initialDesign={tpl.design}
    />
  )
}
