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

  // State 3 (lowest priority on the spec but the simplest to evaluate
  // first): monitor inactive.
  if (data.received_rows === 0 || data.last_import_at === null) {
    return (
      <div className="mb-4 md:mb-6 flex items-center gap-2 rounded-xl border border-amber-900/60 bg-amber-950/40 px-4 py-2.5 text-xs md:text-sm text-amber-300">
        <CircleDashed size={14} className="shrink-0" />
        <span>Dispatch monitor inactive — no Acutrack export loaded yet.</span>
      </div>
    )
  }

  // State 1: active alerts.
  if (data.count > 0) {
    return (
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
            <table className="w-full text-xs min-w-[600px]">
              <thead>
                <tr className="border-b border-red-900/40">
                  <th className="text-left  px-4 py-2 text-red-300/70 font-medium">Order #</th>
                  <th className="text-left  px-4 py-2 text-red-300/70 font-medium">Email</th>
                  <th className="text-left  px-4 py-2 text-red-300/70 font-medium">Paid</th>
                  <th className="text-right px-4 py-2 text-red-300/70 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.payhere_id} className="border-b border-red-900/30 last:border-0">
                    <td className="px-4 py-2 font-mono text-red-100">{o.order_id}</td>
                    <td className="px-4 py-2 text-red-200">{o.email}</td>
                    <td className="px-4 py-2 text-red-200 whitespace-nowrap">{fmtDateTime(o.paid_at)}</td>
                    <td className="px-4 py-2 text-right">
                      <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-red-900/60 text-red-100 uppercase tracking-wide">
                        {reasonTag(o.reason)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // State 2: all clear. Dismissible for the session — once the user
  // closes today's strip they won't see it again until as_of_date ticks.
  if (dismissed) return null
  return (
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
  )
}
