import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { withRetry } from '@/lib/supabase'
import ContactDetail, { type ContactDetailPayload } from '@/components/marketing/ContactDetail'

export const dynamic = 'force-dynamic'

export default async function ContactDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (Number.isNaN(id)) notFound()

  const supabase = await createClient()
  const { data, error } = await withRetry(
    async () => await supabase.rpc('marketing_get_contact_detail', { p_id: id }),
    'marketing_get_contact_detail',
  )
  if (error) {
    if (error.code === 'P0002' || error.code === '02000' || /not found/i.test(error.message)) notFound()
    throw error
  }
  if (!data) notFound()

  return <ContactDetail data={data as ContactDetailPayload} />
}
