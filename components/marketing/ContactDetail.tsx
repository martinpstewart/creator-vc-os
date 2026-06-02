'use client'

import Link from 'next/link'
import { ArrowLeft, ExternalLink, Globe, ShoppingBag, UserCircle } from 'lucide-react'
import { relTime } from './types'

// ============================================================
// Payload shape returned by marketing_get_contact_detail.
// Keep these field-for-field aligned with the SQL.
// ============================================================
export type ContactDetailPayload = {
  contact: {
    id: number
    email: string
    first_name: string | null
    last_name: string | null
    marketing_consent: boolean
    marketing_consent_at: string | null
    marketing_consent_source: string | null
    unsubscribed_at: string | null
    bounce_state: string
    spam_complained_at: string | null
    customer_id: number | null
    is_test: boolean
    test_campaign_id: number | null
    first_seen_at: string
    last_seen_at: string
    created_at: string
    updated_at: string
  }
  customer: {
    id: number
    email: string
    shipping_country_code: string | null
    shipping_country: string | null
    shipping_city: string | null
    created_at: string
    updated_at: string
    total_orders: number
    total_line_items: number
    total_quantity_purchased: number
    total_spend: string | number
  } | null
  engagement: {
    campaign_id: number
    campaign_name: string | null
    signed_up: boolean
    is_backer: boolean
    role: string
    first_signed_up_at: string | null
    last_signed_up_at: string | null
    total_signups: number
    first_backed_at: string | null
    last_backed_at: string | null
    shopify_orders: number
    isod_orders: number
    total_orders: number
    shopify_spend_pence: number | string
    shopify_units: number
  }[]
  signups: {
    id: number
    microsite_id: number
    page_slug: string | null
    page_title: string | null
    campaign_id: number | null
    campaign_name: string | null
    country_code: string | null
    utm_source: string | null
    utm_medium: string | null
    utm_campaign: string | null
    utm_term: string | null
    utm_content: string | null
    email: string
    first_name: string | null
    last_name: string | null
    form_data: Record<string, unknown> | null
    ip: string | null
    user_agent: string | null
    submitted_at: string
  }[]
  sources: {
    id: number
    source_type: string
    source_microsite_signup_id: number | null
    source_raw_order_id: number | null
    source_isod_order_id: number | null
    campaign_id: number | null
    campaign_name: string | null
    metadata: Record<string, unknown> | null
    created_at: string
  }[]
  totals: {
    signups: number
    campaigns_engaged: number
    lifetime_orders: number
    lifetime_spend_pence: number | string
  }
}

const ROLE_LABEL: Record<string, string> = {
  signed_up_and_backed: 'Signed up + backed',
  backed_only: 'Backed',
  signed_up_only: 'Signed up',
  none: 'No engagement',
}

const SOURCE_LABEL: Record<string, string> = {
  microsite_signup: 'Microsite signup',
  shopify_checkout_optin: 'Shopify checkout',
  csv_import: 'CSV import',
  manual: 'Manual',
  legacy_customer_backfill: 'Legacy customer backfill',
}

function fmtInt(n: number | string | null | undefined): string {
  if (n == null) return '—'
  const v = typeof n === 'string' ? Number(n) : n
  if (!Number.isFinite(v)) return '—'
  return new Intl.NumberFormat('en-US').format(v)
}

function fmtPence(p: number | string | null | undefined): string {
  if (p == null) return '£0'
  const v = typeof p === 'string' ? Number(p) : p
  if (!Number.isFinite(v)) return '£0'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(v / 100)
}

function fmtCurrency(n: number | string | null | undefined): string {
  if (n == null) return '—'
  const v = typeof n === 'string' ? Number(n) : n
  if (!Number.isFinite(v)) return '—'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(v)
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function flagEmoji(code: string | null | undefined): string {
  if (!code || code.length !== 2) return ''
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(0x1f1a5 + c.charCodeAt(0)))
}

let countryNameCache: Intl.DisplayNames | null = null
function countryName(code: string | null | undefined): string | null {
  if (!code) return null
  if (!countryNameCache) {
    try {
      countryNameCache = new Intl.DisplayNames(['en'], { type: 'region' })
    } catch {
      return code.toUpperCase()
    }
  }
  try {
    return countryNameCache.of(code.toUpperCase()) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

export default function ContactDetail({ data }: { data: ContactDetailPayload }) {
  const { contact, customer, engagement, signups, sources, totals } = data
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—'

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <Link
        href="/marketing?tab=contacts"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors mb-4"
      >
        <ArrowLeft size={14} /> Back to contacts
      </Link>

      {/* Header */}
      <header className="mb-6 md:mb-8 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className="text-xl md:text-2xl font-semibold text-white truncate">{fullName}</h1>
            {contact.is_test && (
              <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-purple-950 text-purple-300 border border-purple-900/60">
                Test
              </span>
            )}
          </div>
          <p className="text-sm text-zinc-400 font-mono truncate">{contact.email}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {contact.marketing_consent ? (
              <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-900/60">
                Consented
              </span>
            ) : (
              <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-900 text-zinc-400 border border-zinc-800">
                Not consented
              </span>
            )}
            {contact.unsubscribed_at && (
              <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950 text-amber-300 border border-amber-900/60">
                Unsubscribed
              </span>
            )}
            {contact.bounce_state === 'hard' && (
              <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-red-950 text-red-300 border border-red-900/60">
                Hard-bounced
              </span>
            )}
            {contact.bounce_state === 'soft' && (
              <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950 text-amber-300 border border-amber-900/60">
                Soft bounce
              </span>
            )}
            {contact.spam_complained_at && (
              <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-red-950 text-red-300 border border-red-900/60">
                Complained
              </span>
            )}
            {customer && (
              <Link
                href={`/customers/${encodeURIComponent(contact.email)}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-900 text-[#3B9EE8] border border-zinc-800 hover:text-white hover:border-zinc-700 transition-colors"
              >
                <UserCircle size={11} /> Customer record
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* KPI row */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Lifetime spend" value={fmtPence(totals.lifetime_spend_pence)} tone="emerald" />
        <Kpi label="Lifetime orders" value={fmtInt(totals.lifetime_orders)} />
        <Kpi label="Campaigns engaged" value={fmtInt(totals.campaigns_engaged)} />
        <Kpi label="Form signups" value={fmtInt(totals.signups)} />
      </section>

      {/* Identity + customer */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-white mb-4">Profile</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
          <Field label="Email">{contact.email}</Field>
          <Field label="Name">{fullName}</Field>
          <Field label="Consent">
            {contact.marketing_consent
              ? `Yes — ${contact.marketing_consent_source ?? 'unknown source'}${
                  contact.marketing_consent_at ? ` (${relTime(contact.marketing_consent_at)})` : ''
                }`
              : 'No'}
          </Field>
          <Field label="First seen">{fmtDateTime(contact.first_seen_at)}</Field>
          <Field label="Last seen">{fmtDateTime(contact.last_seen_at)}</Field>
          <Field label="Suppression">
            {[
              contact.unsubscribed_at && 'unsubscribed',
              contact.bounce_state !== 'none' && contact.bounce_state,
              contact.spam_complained_at && 'complained',
            ]
              .filter(Boolean)
              .join(' · ') || 'clean'}
          </Field>
        </dl>

        {customer && (
          <>
            <div className="border-t border-zinc-800 my-5" />
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <ShoppingBag size={14} className="text-zinc-500" /> Customer record
            </h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              <Field label="Country">
                {customer.shipping_country_code ? (
                  <span>
                    <span className="mr-1">{flagEmoji(customer.shipping_country_code)}</span>
                    {customer.shipping_country ?? countryName(customer.shipping_country_code)}
                  </span>
                ) : (
                  '—'
                )}
              </Field>
              <Field label="City">{customer.shipping_city ?? '—'}</Field>
              <Field label="Total spend">{fmtCurrency(customer.total_spend)}</Field>
              <Field label="Total orders">{fmtInt(customer.total_orders)}</Field>
              <Field label="Line items">{fmtInt(customer.total_line_items)}</Field>
              <Field label="Quantity purchased">{fmtInt(customer.total_quantity_purchased)}</Field>
            </dl>
          </>
        )}
      </section>

      {/* Campaign engagement */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-white">Campaign engagement</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {engagement.length === 0
              ? 'No engagement on file yet.'
              : `${engagement.length} campaign${engagement.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {engagement.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/40">
                  <Th>Campaign</Th>
                  <Th>Role</Th>
                  <Th right>Orders</Th>
                  <Th right>Units</Th>
                  <Th right>Spend</Th>
                  <Th>Signups</Th>
                  <Th>Last activity</Th>
                </tr>
              </thead>
              <tbody>
                {engagement.map((e) => {
                  const last =
                    [e.last_backed_at, e.last_signed_up_at]
                      .filter((d): d is string => !!d)
                      .sort()
                      .pop() ?? null
                  return (
                    <tr key={e.campaign_id} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                      <td className="px-5 py-3 font-medium text-white">
                        {e.campaign_name ?? `Campaign ${e.campaign_id}`}
                      </td>
                      <td className="px-5 py-3 text-zinc-300">
                        {ROLE_LABEL[e.role] ?? e.role}
                      </td>
                      <td className="px-5 py-3 text-right text-zinc-300 tabular-nums">{fmtInt(e.total_orders)}</td>
                      <td className="px-5 py-3 text-right text-zinc-300 tabular-nums">{fmtInt(e.shopify_units)}</td>
                      <td className="px-5 py-3 text-right text-zinc-200 tabular-nums">{fmtPence(e.shopify_spend_pence)}</td>
                      <td className="px-5 py-3 text-zinc-400 tabular-nums">{fmtInt(e.total_signups)}</td>
                      <td className="px-5 py-3 text-zinc-500 text-xs whitespace-nowrap">{relTime(last)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Signup history */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-white">Microsite signups</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {signups.length === 0
              ? 'No form signups yet.'
              : `${signups.length} submission${signups.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {signups.length > 0 && (
          <ul className="divide-y divide-zinc-800/60">
            {signups.map((s) => (
              <li key={s.id} className="px-5 py-3 hover:bg-zinc-800/30 transition-colors">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="font-medium text-white">{s.page_title ?? s.page_slug ?? '(page removed)'}</span>
                      {s.page_slug && (
                        <a
                          href={`/p/${s.page_slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-[#3B9EE8] hover:underline font-mono inline-flex items-center gap-1"
                        >
                          /p/{s.page_slug} <ExternalLink size={10} />
                        </a>
                      )}
                      {s.campaign_name && (
                        <>
                          <span className="text-zinc-700">·</span>
                          <span className="text-xs text-zinc-400">{s.campaign_name}</span>
                        </>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 flex-wrap text-[11px] text-zinc-500">
                      {s.country_code && (
                        <span className="inline-flex items-center gap-1">
                          <Globe size={11} /> {flagEmoji(s.country_code)} {countryName(s.country_code)}
                        </span>
                      )}
                      {s.utm_source && (
                        <span>
                          via <span className="text-zinc-300">{s.utm_source}</span>
                          {s.utm_medium && <> ({s.utm_medium})</>}
                          {s.utm_campaign && <> · {s.utm_campaign}</>}
                        </span>
                      )}
                      {s.ip && <span className="font-mono text-zinc-600">{s.ip}</span>}
                    </div>
                  </div>
                  <span className="text-xs text-zinc-500 whitespace-nowrap" title={fmtDateTime(s.submitted_at)}>
                    {relTime(s.submitted_at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Source audit */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-white">How we got this contact</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Append-only audit trail of every event that linked this contact into the system.
          </p>
        </div>
        {sources.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-500">No source records.</p>
        ) : (
          <ul className="divide-y divide-zinc-800/60">
            {sources.map((src) => (
              <li key={src.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-zinc-200">
                    {SOURCE_LABEL[src.source_type] ?? src.source_type}
                    {src.campaign_name && (
                      <span className="text-zinc-500"> · {src.campaign_name}</span>
                    )}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">{fmtDateTime(src.created_at)}</p>
                </div>
                <span className="text-xs text-zinc-500 whitespace-nowrap">{relTime(src.created_at)}</span>
              </li>
            ))}
          </ul>
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

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-5 py-2.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wide ${
        right ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'emerald' }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1">{label}</p>
      <p
        className={`text-2xl font-bold tabular-nums ${tone === 'emerald' ? 'text-emerald-300' : 'text-white'}`}
      >
        {value}
      </p>
    </div>
  )
}
