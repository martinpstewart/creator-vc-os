import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { withRetry } from '@/lib/supabase'
import SendDetail from '@/components/marketing/SendDetail'
import type { SendDetailRow } from '@/components/marketing/types'

export const dynamic = 'force-dynamic'

export default async function SendDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (Number.isNaN(id)) notFound()

  const supabase = await createClient()
  const { data, error } = await withRetry(
    async () => await supabase.rpc('marketing_get_send', { p_id: id }),
    'marketing_get_send',
  )
  if (error) throw error

  // The RPC returns SETOF — supabase-js gives back an array.
  const rows = (data as SendDetailRow[] | null) ?? []
  const send = rows[0]
  if (!send) notFound()

  return <SendDetail send={send} />
}
