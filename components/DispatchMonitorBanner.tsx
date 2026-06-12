'use client'

// Dispatch monitor — surfaces paid orders that haven't reached
// Acutrack (our fulfilment partner). We independently poll Payhere
// (paid shipping orders) into Supabase and reconcile against the
// Acutrack received export; this banner highlights the offenders so
// Glide's silent dispatch failures get caught.
//
// Read-only — calls public.get_dispatch_alerts (SECURITY DEFINER,
// granted to anon) and renders one of three states based on the
// payload. Failure is silent by design: a broken monitor must never
// blank the dashboard.
//
// Refetches when the tab regains focus/visibility so a sticky tab
// reflects the latest reconciliation without a full reload.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, CircleDashed, X } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { isOwner } from '@/lib/auth'
import { formatErrorMessage } from '@/lib/format-error'
import { useAuth } from './AuthProvider'

type DispatchAlertOrder = {
  payhere_id: number
  order_id: string
  email: string
  amount: number
  currency: string
  paid_at: string
  reason: string  // 'missing_from_acutrack' | 'unlinkable_no_order_id' | other
}

type DispatchAlertResponse = {
  last_import_at: string | null
  as_of_date: string | null
  received_rows: number
  count: number
  // Number of paid Payhere payments past the 24h grace whose
  // payhere_created_at is NEWER than the latest Acutrack export's
  // as_of_date. They're outside the evaluation window — neither
  // green-clear nor red-flagged. Surfaced as a separate amber strip
  // so the operator knows the silent skip exists and can clear it
  // by uploading a fresh export.
  not_yet_checkable?: number
  orders: DispatchAlertOrder[]
}

// Session-scoped dismissal key. Keyed on as_of_date so dismissing
// today's all-clear doesn't suppress tomorrow's banner.
const DISMISS_KEY_PREFIX = 'dispatch-monitor-dismissed-allclear:'

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try { return dateFmt.format(new Date(iso)) } catch { return iso }
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  try { return dateTimeFmt.format(new Date(iso)) } catch { return iso }
}

function reasonTag(reason: string): string {
  if (reason === 'missing_from_acutrack')  return 'Not in Acutrack'
  if (reason === 'unlinkable_no_order_id') return 'No order ID on payment'
  return reason
}

export default function DispatchMonitorBanner() {
  // Owner-only surface. Other admins land on / but never see the
  // banner. We check first so we don't even fire the RPC for users
  // who can't act on the result.
  const { user } = useAuth()
  const allowed = isOwner(user?.email)

  // null = haven't loaded yet (render nothing — don't block page).
  // After the first successful fetch we hold the payload; errors are
  // swallowed and we also render nothing in that case.
  const [data, setData] = useState<DispatchAlertResponse | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  // Per-row pending state for the Dismiss action so we can spin only
  // the row in flight instead of disabling the whole list.
  const [dismissingId, setDismissingId] = useState<number | null>(null)
  const [dismissError, setDismissError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('get_dispatch_alerts')
      if (error) {
        console.log('[DispatchMonitor] rpc error', error)
        return
      }
      setData(data as DispatchAlertResponse)
    } catch (e) {
      // Network blip, Supabase outage, anything. Don't break the page.
      console.log('[DispatchMonitor] fetch failed', e)
    }
  }, [])

  // Initial fetch + refetch when the tab comes back to the foreground.
  // `visibilitychange` covers tab-switching, `focus` covers window-
  // level focus (alt-tabbing back to a single-tab window). Guarded
  // on `allowed` so non-owner sessions never hit the RPC.
  useEffect(() => {
    if (!allowed) return
    void fetchData()
    function onVisibility() {
      if (document.visibilityState === 'visible') void fetchData()
    }
    function onFocus() { void fetchData() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [allowed, fetchData])

  // Inline action: dismiss a single alert row via the
  // dismiss_dispatch_alert RPC. Prompts the operator for a reason
  // (logged in the dismissals table for audit). On success, refetch
  // so the dismissed row disappears; on failure, surface the message
  // — common case is the owner check failing for a non-Martin admin.
  const dismissRow = useCallback(async (payhereId: number, email: string) => {
    const reason = window.prompt(
      `Dismiss alert for ${email}?\n\nReason (recorded for audit — e.g. "for another campaign", "manually reconciled"):`,
      '',
    )
    if (reason === null) return // user cancelled
    const trimmed = reason.trim()
    if (!trimmed) {
      setDismissError('A reason is required.')
      return
    }
    setDismissingId(payhereId)
    setDismissError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.rpc('dismiss_dispatch_alert', {
        p_payhere_id: payhereId,
        p_reason: trimmed,
      })
      if (error) throw error
      await fetchData()
    } catch (e) {
      setDismissError(formatErrorMessage(e))
    } finally {
      setDismissingId(null)
    }
  }, [fetchData])

  // Re-evaluate dismissal whenever the as_of_date changes. We key the
  // session-storage flag on as_of_date specifically so today's
  // dismissal doesn't carry into tomorrow's monitor state.
  useEffect(() => {
    if (!data || data.count !== 0 || data.received_rows === 0) {
      setDismissed(false)
      return
    }
    try {
      const key = DISMISS_KEY_PREFIX + (data.as_of_date ?? 'no-date')
      if (sessionStorage.getItem(key) === '1') setDismissed(true)
      else setDismissed(false)
    } catch {
      // private mode / SSR — treat as not-dismissed
      setDismissed(false)
    }
  }, [data])

  if (!allowed) return null
  if (!data) return null

  // The "not yet checkable" strip is orthogonal to the red/green/amber
  // main state — paid Payhere payments newer than the Acutrack export
  // can exist alongside any of those states. Rendered as its own
  // strip *below* whichever main banner shows, so the operator sees
  // both the audit verdict and the silent-skip bucket at a glance.
  const unchecked = Number(data.not_yet_checkable ?? 0)
  const UncheckedStrip = unchecked > 0 ? (
    <div className="mb-4 md:mb-6 -mt-2 md:-mt-3 flex items-start gap-2 rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-2 text-[11px] md:text-xs text-amber-300/90">
      <CircleDashed size={12} className="shrink-0 mt-[3px]" />
      <span>
        <strong className="text-amber-200 font-semibold">{unchecked.toLocaleString()}</strong>{' '}
        paid order{unchecked === 1 ? '' : 's'} newer than the Acutrack export
        {' '}({data.as_of_date ?? 'unknown'}) — not yet checkable.{' '}
        <a href="/settings" className="underline hover:text-amber-100">
          Upload a fresh export
        </a>{' '}
        to evaluate them.
      </span>
    </div>
  ) : null

  // State 3 (lowest priority on the spec but the simplest to evaluate
  // first): monitor inactive.
  if (data.received_rows === 0 || data.last_import_at === null) {
    return (
      <>
        <div className="mb-4 md:mb-6 flex items-center gap-2 rounded-xl border border-amber-900/60 bg-amber-950/40 px-4 py-2.5 text-xs md:text-sm text-amber-300">
          <CircleDashed size={14} className="shrink-0" />
          <span>Dispatch monitor inactive — no Acutrack export loaded yet.</span>
        </div>
        {UncheckedStrip}
      </>
    )
  }

  // State 1: active alerts.
  if (data.count > 0) {
    return (
      <>
      <div className="mb-4 md:mb-6 rounded-xl border border-red-900/60 bg-red-950/40 overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-red-950/30 transition-colors"
        >
          <div className="flex items-center gap-2.5 text-red-300 min-w-0">
            <AlertTriangle size={16} className="shrink-0" />
            <p className="text-sm font-semibold truncate">
              ⚠ {data.count} paid order{data.count === 1 ? '' : 's'} not yet dispatched to Acutrack
            </p>
          </div>
          {expanded ? (
            <ChevronUp size={16} className="text-red-300/70 shrink-0" />
          ) : (
            <ChevronDown size={16} className="text-red-300/70 shrink-0" />
          )}
        </button>
        {expanded && (
          <div className="border-t border-red-900/60 overflow-x-auto">
            {dismissError && (
              <p className="px-4 py-2 text-[11px] text-red-200 bg-red-900/30 border-b border-red-900/40">
                Dismiss failed: {dismissError}
              </p>
            )}
            <table className="w-full text-xs min-w-[700px]">
              <thead>
                <tr className="border-b border-red-900/40">
                  <th className="text-left  px-4 py-2 text-red-300/70 font-medium">Order #</th>
                  <th className="text-left  px-4 py-2 text-red-300/70 font-medium">Email</th>
                  <th className="text-left  px-4 py-2 text-red-300/70 font-medium">Paid</th>
                  <th className="text-left  px-4 py-2 text-red-300/70 font-medium">Reason</th>
                  <th className="text-right px-4 py-2 text-red-300/70 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => {
                  const busy = dismissingId === o.payhere_id
                  return (
                    <tr key={o.payhere_id} className={`border-b border-red-900/30 last:border-0 ${busy ? 'opacity-40' : ''}`}>
                      <td className="px-4 py-2 font-mono text-red-100">{o.order_id ?? '—'}</td>
                      <td className="px-4 py-2 text-red-200">{o.email}</td>
                      <td className="px-4 py-2 text-red-200 whitespace-nowrap">{fmtDateTime(o.paid_at)}</td>
                      <td className="px-4 py-2">
                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-red-900/60 text-red-100 uppercase tracking-wide">
                          {reasonTag(o.reason)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => dismissRow(o.payhere_id, o.email)}
                          className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-medium text-red-100/80 hover:text-white hover:bg-red-900/60 disabled:opacity-40 transition-colors"
                          title="Remove this row from the dispatch monitor — records a reason for audit"
                        >
                          {busy ? 'Dismissing…' : 'Dismiss'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {UncheckedStrip}
      </>
    )
  }

  // State 2: all clear. Dismissible for the session — once the user
  // closes today's strip they won't see it again until as_of_date ticks.
  if (dismissed) return UncheckedStrip
  return (
    <>
    <div className="mb-4 md:mb-6 flex items-center justify-between gap-3 rounded-xl border border-emerald-900/60 bg-emerald-950/40 px-4 py-2 text-xs text-emerald-300">
      <div className="flex items-center gap-2 min-w-0">
        <CheckCircle2 size={13} className="shrink-0" />
        <span className="truncate">
          Dispatch monitor: all clear (Acutrack import {fmtDate(data.as_of_date)})
        </span>
      </div>
      <button
        type="button"
        onClick={() => {
          try {
            const key = DISMISS_KEY_PREFIX + (data.as_of_date ?? 'no-date')
            sessionStorage.setItem(key, '1')
          } catch { /* private mode — that's fine, dismissal won't persist */ }
          setDismissed(true)
        }}
        className="text-emerald-300/60 hover:text-emerald-100 transition-colors shrink-0"
        aria-label="Dismiss for this session"
      >
        <X size={14} />
      </button>
    </div>
    {UncheckedStrip}
    </>
  )
}
