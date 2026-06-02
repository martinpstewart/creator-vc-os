'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import {
  STATUS_LABEL,
  PRIORITY_LABEL,
  statusTone,
  priorityTone,
  htmlToPlainText,
  ticketHandler,
  ticketRequesterLabel,
  relTime,
  type TicketDetail,
  type TicketEvent,
  type TicketStatus,
  type TicketPriority,
} from '@/lib/tickets'

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Read-only mirror of a Freshdesk ticket. All write actions (status
// change / reply / assign / edit) live in Freshdesk now; the prominent
// "Open in Freshdesk" link is the single CTA.
export default function TicketDetailView({ detail }: { detail: TicketDetail }) {
  const { ticket, customer, events } = detail

  const st = statusTone(ticket.status)
  const pt = priorityTone(ticket.priority)

  // Requester block — prefer the matched customer, fall back to the raw
  // Freshdesk requester fields when the customer wasn't resolved.
  const customerName =
    customer
      ? ([customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() ||
          customer.email)
      : null
  const requester = ticketRequesterLabel({
    customer_name: customerName,
    customer_email: customer?.email ?? null,
    requester_name: ticket.requester_name,
    requester_email: ticket.requester_email,
  })

  const handler = ticketHandler(ticket)
  // Description arrives as raw email HTML — strip to plain text. For the
  // rich rendering staff jump to Freshdesk.
  const description = useMemo(() => htmlToPlainText(ticket.description), [ticket.description])

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 md:p-6">
        <div className="flex flex-wrap items-start gap-3 mb-3">
          <span className="font-mono text-xs text-zinc-500">{ticket.ticket_number}</span>
          <span
            className={`inline-flex items-center text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border ${st.bg} ${st.text} ${st.border}`}
          >
            {STATUS_LABEL[ticket.status as TicketStatus] ?? ticket.status}
          </span>
          <span
            className={`inline-flex items-center text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border ${pt.bg} ${pt.text} ${pt.border}`}
          >
            {PRIORITY_LABEL[ticket.priority as TicketPriority] ?? ticket.priority}
          </span>
          {ticket.source && (
            <span className="inline-flex items-center text-[10px] uppercase tracking-wide font-medium text-zinc-400 bg-zinc-800/80 px-1.5 py-0.5 rounded">
              {ticket.source}
            </span>
          )}
          <div className="ml-auto">
            {ticket.freshdesk_url && (
              <a
                href={ticket.freshdesk_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3B9EE8] hover:bg-[#3691d4] text-white text-sm font-medium transition-colors"
              >
                <ExternalLink size={14} strokeWidth={1.75} />
                Open in Freshdesk
              </a>
            )}
          </div>
        </div>

        <h1 className="text-xl md:text-2xl font-semibold text-white break-words">
          {ticket.subject || <span className="text-zinc-500 italic">(no subject)</span>}
        </h1>

        {description && (
          <div className="mt-4 bg-zinc-950/40 border border-zinc-800 rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500 font-medium mb-2">
              Description
            </p>
            <p className="text-sm text-zinc-200 whitespace-pre-wrap break-words">
              {description}
            </p>
          </div>
        )}

        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mt-5 text-sm">
          <Field label="Requester">
            {customer ? (
              <Link
                href={`/customers/${encodeURIComponent(customer.email)}`}
                className="text-white hover:text-zinc-300"
              >
                {requester.primary}
              </Link>
            ) : (
              <span className="text-white">{requester.primary}</span>
            )}
            {requester.secondary && (
              <p className="text-[11px] text-zinc-500">{requester.secondary}</p>
            )}
            {!customer && (
              <p className="mt-1 inline-flex items-center text-[10px] uppercase tracking-wide font-medium text-amber-400/80 bg-amber-950/40 border border-amber-900/60 px-1.5 py-0.5 rounded">
                Unmatched customer
              </p>
            )}
          </Field>

          <Field label="Agent">
            {handler ? (
              <span className="text-zinc-300">{handler}</span>
            ) : (
              <span className="text-zinc-600">Unassigned</span>
            )}
          </Field>

          <Field label="Group">
            <span className="text-zinc-300">{ticket.group_name ?? '—'}</span>
          </Field>

          <Field label="Order ref">
            {ticket.order_ref ? (
              <span className="font-mono text-zinc-200">
                {ticket.order_ref}
                {ticket.order_source && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-zinc-500 bg-zinc-800/80 px-1.5 py-0.5 rounded">
                    {ticket.order_source}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-zinc-600">—</span>
            )}
          </Field>

          {ticket.film_raw && (
            <Field label="Film">
              <span className="text-zinc-300">{ticket.film_raw}</span>
              {!ticket.campaign_id && (
                <p className="text-[10px] text-zinc-600 mt-0.5">
                  Not yet linked to a campaign.
                </p>
              )}
            </Field>
          )}

          <Field label="Created">
            <span className="text-zinc-300">{fmtDateTime(ticket.created_at)}</span>
          </Field>

          <Field label="Last action">
            <span className="text-zinc-300">{fmtDateTime(ticket.last_actioned_at)}</span>
          </Field>

          <Field label="Closed">
            {ticket.closed_at ? (
              <span className="text-zinc-300">{fmtDateTime(ticket.closed_at)}</span>
            ) : (
              <span className="text-zinc-600">—</span>
            )}
          </Field>
        </dl>
      </div>

      {/* Activity timeline */}
      <Timeline events={events} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-zinc-500 font-medium">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  )
}

// ============================================================
// Timeline — newest first; bodies are typically null on Freshdesk events
// (reply text isn't captured yet). Render event type + timestamp.
// ============================================================

function Timeline({ events }: { events: TicketEvent[] }) {
  // Events come oldest-first from the RPC; flip for display.
  const ordered = useMemo(() => [...events].reverse(), [events])

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
      <div className="px-5 md:px-6 py-3 border-b border-zinc-800 flex items-baseline justify-between">
        <p className="text-xs uppercase tracking-wide text-zinc-500 font-medium">Activity</p>
        <p className="text-[10px] text-zinc-600">
          Comment bodies aren&apos;t yet captured — view replies in Freshdesk.
        </p>
      </div>
      {ordered.length === 0 ? (
        <p className="px-5 md:px-6 py-6 text-sm text-zinc-500">No activity yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-800/60">
          {ordered.map((e) => (
            <TimelineRow key={e.id} event={e} />
          ))}
        </ul>
      )}
    </div>
  )
}

function TimelineRow({ event }: { event: TicketEvent }) {
  return (
    <li className="px-5 md:px-6 py-4">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <p className="text-xs text-zinc-300">
          <EventLabel event={event} />
        </p>
        <p
          className="text-[11px] text-zinc-500 whitespace-nowrap"
          title={fmtDateTime(event.created_at)}
        >
          {relTime(event.created_at)}
        </p>
      </div>
      {event.body && (
        <p className="text-sm text-zinc-200 mt-1 whitespace-pre-wrap break-words">
          {event.body}
        </p>
      )}
    </li>
  )
}

function EventLabel({ event }: { event: TicketEvent }) {
  // Freshdesk-originated events have actor = null; render as "Freshdesk"
  // to make the source obvious.
  const actor = event.actor_name ?? event.actor_email ?? 'Freshdesk'
  switch (event.event_type) {
    case 'created':
      return (
        <>
          <span className="font-medium text-white">{actor}</span> created the ticket
        </>
      )
    case 'comment':
      return (
        <>
          <span className="font-medium text-white">{actor}</span> added a reply
        </>
      )
    case 'status_change':
      return (
        <>
          <span className="font-medium text-white">{actor}</span> changed status{' '}
          <span className="text-zinc-400">
            {event.old_status ?? '?'} → {event.new_status ?? '?'}
          </span>
        </>
      )
    case 'reassigned':
      return (
        <>
          <span className="font-medium text-white">{actor}</span> reassigned the ticket
        </>
      )
    case 'edited':
      return (
        <>
          <span className="font-medium text-white">{actor}</span> edited ticket details
        </>
      )
    default:
      return (
        <>
          <span className="font-medium text-white">{actor}</span> {event.event_type}
        </>
      )
  }
}
