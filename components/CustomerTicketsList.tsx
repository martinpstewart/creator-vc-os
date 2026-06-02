import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import {
  STATUS_LABEL,
  PRIORITY_LABEL,
  statusTone,
  priorityTone,
  ticketHandler,
  relTime,
  type CustomerTicketRow,
  type TicketStatus,
} from '@/lib/tickets'

// Inline list of a customer's tickets on the customer detail screen.
// Read-only mirror of Freshdesk — every row deep-links to Freshdesk for
// the rich view. Empty state points staff at Freshdesk to raise new
// tickets (the app no longer has a Raise-Ticket flow).
export default function CustomerTicketsList({ tickets }: { tickets: CustomerTicketRow[] }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
      <div className="px-6 py-4 border-b border-zinc-800 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-white">Tickets</h2>
        <span className="text-xs text-zinc-500">
          {tickets.length} {tickets.length === 1 ? 'ticket' : 'tickets'}
        </span>
      </div>
      {tickets.length === 0 ? (
        <p className="px-6 py-6 text-sm text-zinc-500">
          No tickets for this customer yet. Tickets are raised + actioned in{' '}
          <a
            href="https://creatorvc.freshdesk.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-300 hover:text-white underline"
          >
            Freshdesk
          </a>
          .
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/40">
                <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                  Ticket
                </th>
                <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                  Subject
                </th>
                <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                  Status
                </th>
                <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                  Priority
                </th>
                <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                  Agent
                </th>
                <th className="text-left px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                  Updated
                </th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const st = statusTone(t.status)
                const pt = priorityTone(t.priority)
                const handler = ticketHandler(t)
                return (
                  <tr
                    key={t.id}
                    className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="px-5 py-3 font-mono text-xs text-zinc-300">
                      <Link
                        href={`/tickets/${t.id}`}
                        className="hover:text-white transition-colors"
                      >
                        {t.ticket_number}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/tickets/${t.id}`}
                        className="font-medium text-white hover:text-zinc-300 transition-colors"
                      >
                        {t.subject || <span className="text-zinc-500 italic">(no subject)</span>}
                      </Link>
                      {t.source && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-zinc-500 bg-zinc-800/80 px-1.5 py-0.5 rounded">
                          {t.source}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border ${st.bg} ${st.text} ${st.border}`}
                      >
                        {STATUS_LABEL[t.status as TicketStatus] ?? t.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border ${pt.bg} ${pt.text} ${pt.border}`}
                      >
                        {PRIORITY_LABEL[t.priority] ?? t.priority}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-zinc-400">
                      {handler ?? <span className="text-zinc-600">Unassigned</span>}
                    </td>
                    <td className="px-5 py-3 text-zinc-400">
                      <span className="text-zinc-300">{relTime(t.last_actioned_at ?? t.created_at)}</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {t.freshdesk_url && (
                        <a
                          href={t.freshdesk_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open in Freshdesk"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-zinc-300 bg-zinc-800/60 hover:bg-zinc-700 hover:text-white transition-colors"
                        >
                          <ExternalLink size={12} strokeWidth={1.75} />
                          Freshdesk
                        </a>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
