import { Ticket } from 'lucide-react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getCurrentRole } from '@/lib/auth-server'
import {
  listTickets,
  getTicketStatusCounts,
  getTicketsCreatedTimeline,
  type TicketStatusCounts,
  type TicketTimelinePoint,
} from '@/lib/tickets'
import { canAccess } from '@/lib/auth'
import ThirtyDayChart from '@/components/ThirtyDayChart'
import TicketsListView from './TicketsListView'

// Tickets list — server-renders the first page with default filters so
// staff land on something useful immediately; the client component takes
// over for filter changes, search, and pagination. The counts + 30-day
// timeline are fetched alongside and stay static for the session — they
// describe the full dataset, not the current filter view.
export const dynamic = 'force-dynamic'

export default async function TicketsPage() {
  const role = await getCurrentRole()
  if (!canAccess(role, 'tickets')) redirect('/')

  const supabase = await createClient()
  // Fan out: list (first page), badge counts, and 30-day timeline. Each
  // failure is tolerated — empty fallbacks below so a partial outage
  // doesn't blank the whole screen.
  const [list, counts, timeline] = await Promise.all([
    listTickets(supabase, { page: 1, pageSize: 25 }).catch((e) => {
      console.error('[tickets] initial list failed', e)
      return { rows: [], total: 0 }
    }),
    getTicketStatusCounts(supabase).catch((e): TicketStatusCounts => {
      console.error('[tickets] counts failed', e)
      return { all: 0, Open: 0, Pending: 0, Resolved: 0, Closed: 0, other: 0 }
    }),
    getTicketsCreatedTimeline(supabase, 30).catch((e): TicketTimelinePoint[] => {
      console.error('[tickets] timeline failed', e)
      return []
    }),
  ])

  return (
    <div className="p-4 md:p-8">
      <header className="mb-6 md:mb-8 flex items-center gap-3">
        <span className="inline-flex items-center justify-center w-9 h-9 md:w-10 md:h-10 rounded-lg bg-[#3B9EE8]">
          <Ticket size={18} className="text-white" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-white">Tickets</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {counts.all.toLocaleString()} {counts.all === 1 ? 'ticket' : 'tickets'}
          </p>
        </div>
      </header>

      {/* 30-day created chart — matches the home dashboard chart UI. */}
      <div className="mb-6 md:mb-8">
        <ThirtyDayChart
          data={timeline}
          idKey="tickets-created"
          subtitle="Tickets created"
          unitNoun="ticket"
          emptyLabel="No tickets created in the last 30 days."
        />
      </div>

      <TicketsListView
        initialRows={list.rows}
        initialTotal={list.total}
        counts={counts}
      />
    </div>
  )
}
