import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { getCurrentRole } from '@/lib/auth-server'
import { getTicket } from '@/lib/tickets'
import { canAccess } from '@/lib/auth'
import TicketDetailView from './TicketDetailView'

export const dynamic = 'force-dynamic'

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ticketId = parseInt(id, 10)
  if (Number.isNaN(ticketId)) notFound()

  const role = await getCurrentRole()
  if (!canAccess(role, 'tickets')) redirect('/')

  const supabase = await createClient()
  const detail = await getTicket(supabase, ticketId).catch(() => null)
  if (!detail) notFound()

  return (
    <div className="p-4 md:p-8">
      <div className="mb-4 md:mb-6">
        <Link
          href="/tickets"
          className="text-xs text-zinc-500 hover:text-white transition-colors"
        >
          ← Tickets
        </Link>
      </div>

      <TicketDetailView detail={detail} />
    </div>
  )
}
