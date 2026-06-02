'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { relTime, sendStatusTone, type SendDetailRow } from './types'

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US').format(n)
}

function rate(num: number, denom: number): string | null {
  if (!denom) return null
  const pct = (num / denom) * 100
  if (pct < 0.01 && num > 0) return '<0.01%'
  return `${pct.toFixed(2)}%`
}

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

export default function SendDetail({ send }: { send: SendDetailRow }) {
  const tone = sendStatusTone(send.status)

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      {/* Back link */}
      <Link
        href="/marketing?sub=history"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors mb-4"
      >
        <ArrowLeft size={14} /> Back to history
      </Link>

      {/* Header */}
      <div className="mb-6 md:mb-8 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-semibold text-white truncate">{send.name}</h1>
          {send.subject && (
            <p className="text-sm text-zinc-400 mt-1 truncate">{send.subject}</p>
          )}
        </div>
        <span
          className={`shrink-0 inline-flex px-2.5 py-1 rounded text-xs font-semibold border ${tone.bg} ${tone.text} ${tone.border}`}
        >
          {tone.label}
        </span>
      </div>

      {/* Metadata grid */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-white mb-4">Details</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
          <Field label="From">
            {send.from_name ? `${send.from_name} <${send.from_address}>` : send.from_address}
          </Field>
          <Field label="Reply-to">{send.reply_to ?? '—'}</Field>
          <Field label="Segment">
            {send.segment_name ?? <span className="text-zinc-600">— none</span>}
          </Field>
          <Field label="Scheduled for">{fmtDateTime(send.scheduled_for)}</Field>
          <Field label="Sending started">{fmtDateTime(send.sending_started_at)}</Field>
          <Field label="Sent at">{fmtDateTime(send.sent_at)}</Field>
          <Field label="Created by">{send.created_by ?? '—'}</Field>
          <Field label="Created">
            {fmtDateTime(send.created_at)} <span className="text-zinc-600">· {relTime(send.created_at)}</span>
          </Field>
          <Field label="Last updated">
            {fmtDateTime(send.updated_at)} <span className="text-zinc-600">· {relTime(send.updated_at)}</span>
          </Field>
        </dl>
      </section>

      {/* Metrics grid */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-white mb-4">Metrics</h2>
        {send.status === 'draft' || send.status === 'scheduled' ? (
          <p className="text-xs text-zinc-500">
            Metrics will appear once the send completes.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard label="Recipients" value={fmt(send.total_recipients)} hint={null} />
            <MetricCard
              label="Sent"
              value={fmt(send.total_sent)}
              hint={rate(send.total_sent, send.total_recipients)}
              hintLabel="of recipients"
            />
            <MetricCard
              label="Delivered"
              value={fmt(send.total_delivered)}
              hint={rate(send.total_delivered, send.total_sent)}
              hintLabel="of sent"
            />
            <MetricCard
              label="Opened"
              value={fmt(send.total_opened)}
              hint={rate(send.total_opened, send.total_delivered)}
              hintLabel="of delivered"
              tone="emerald"
            />
            <MetricCard
              label="Clicked"
              value={fmt(send.total_clicked)}
              hint={rate(send.total_clicked, send.total_delivered)}
              hintLabel="of delivered"
              tone="emerald"
            />
            <MetricCard
              label="Bounced"
              value={fmt(send.total_bounced)}
              hint={rate(send.total_bounced, send.total_sent)}
              hintLabel="of sent"
              tone="amber"
            />
            <MetricCard
              label="Complained"
              value={fmt(send.total_complained)}
              hint={rate(send.total_complained, send.total_delivered)}
              hintLabel="of delivered"
              tone="red"
            />
            <MetricCard
              label="Unsubscribed"
              value={fmt(send.total_unsubscribed)}
              hint={rate(send.total_unsubscribed, send.total_delivered)}
              hintLabel="of delivered"
              tone="amber"
            />
          </div>
        )}
      </section>

      {/* Preview */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-white">Preview</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            The exact HTML that landed (or will land) in subscribers&apos; inboxes.
          </p>
        </div>
        {send.html_rendered ? (
          <iframe
            srcDoc={send.html_rendered}
            sandbox=""
            title={`Preview of ${send.name}`}
            className="w-full bg-white border-0"
            style={{ height: '70vh' }}
          />
        ) : (
          <div className="px-5 py-16 text-center text-sm text-zinc-500">
            No rendered HTML yet — this send is still a draft.
          </div>
        )}
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-zinc-600 mb-0.5">{label}</dt>
      <dd className="text-zinc-200">{children}</dd>
    </div>
  )
}

function MetricCard({
  label,
  value,
  hint,
  hintLabel,
  tone,
}: {
  label: string
  value: string
  hint: string | null
  hintLabel?: string
  tone?: 'emerald' | 'amber' | 'red'
}) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-300'
      : tone === 'amber'
        ? 'text-amber-300'
        : tone === 'red'
          ? 'text-red-300'
          : 'text-white'
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-zinc-600 mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      {hint && (
        <p className="text-[11px] text-zinc-500 mt-1">
          {hint} <span className="text-zinc-600">{hintLabel}</span>
        </p>
      )}
    </div>
  )
}
