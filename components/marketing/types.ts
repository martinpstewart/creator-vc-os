// Shared types for the Marketing screen (Templates + Contacts tabs).
//
// Segment definitions are pure JSON — the same shape the backend
// `count_segment` / `evaluate_segment` / `upsert_segment` RPCs accept.
// Keep this file in sync with the backend brief's "Definition schema".

export type FilterType =
  | 'campaign_engagement'
  | 'consent'
  | 'total_spend_gte'
  | 'total_spend_lte'
  | 'total_orders_gte'
  | 'total_orders_lte'
  | 'signed_up_after'
  | 'signed_up_before'
  | 'country_in'
  | 'is_test'

export type CampaignEngagementRole =
  | 'signed_up'
  | 'backer'
  | 'signed_up_or_backer'
  | 'backed_historic'
  | 'not_backer'
  | 'not_signed_up'
  | 'none'

export type SegmentFilter =
  | { type: 'campaign_engagement'; campaign_id: number; role: CampaignEngagementRole }
  | { type: 'consent'; consented: boolean }
  | { type: 'total_spend_gte'; value_pence: number }
  | { type: 'total_spend_lte'; value_pence: number }
  | { type: 'total_orders_gte'; value: number }
  | { type: 'total_orders_lte'; value: number }
  | { type: 'signed_up_after'; date: string }
  | { type: 'signed_up_before'; date: string }
  | { type: 'country_in'; codes: string[] }
  | { type: 'is_test'; value: boolean }

export type MatchMode = 'all' | 'any'

export type SegmentDefinition = {
  match?: MatchMode
  filters: SegmentFilter[]
}

export type CampaignLite = {
  id: number
  name: string
}

export type ContactRow = {
  id: number
  email: string
  first_name: string | null
  last_name: string | null
  marketing_consent: boolean
  unsubscribed_at: string | null
  bounce_state: string
  spam_complained_at: string | null
  customer_id: number | null
  last_seen_at: string
  is_test: boolean
}

export type SegmentRow = {
  id: number
  name: string
  description: string | null
  definition: SegmentDefinition
  last_evaluated_count: number | null
  last_evaluated_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type TemplateRow = {
  id: number
  name: string
  subject: string | null
  html: string
  updated_at: string
  segment_id: number | null
}

// Landing-page template (Unlayer 'web' mode). Mirrors TemplateRow but
// without subject/segment — landing pages have neither.
export type LandingTemplateRow = {
  id: number
  name: string
  description: string | null
  html: string
  created_by: string | null
  created_at: string
  updated_at: string
}

// A live landing page (microsite) tied to a campaign.
export type MicrositeStatus = 'draft' | 'live' | 'closed'

export type MicrositeRow = {
  id: number
  campaign_id: number
  campaign_name: string | null
  slug: string
  title: string
  description: string | null
  status: MicrositeStatus | string
  html_cached: string | null
  published_at: string | null
  closed_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export function micrositeStatusTone(status: string): {
  bg: string
  text: string
  border: string
  label: string
} {
  switch (status) {
    case 'live':
      return {
        bg: 'bg-emerald-950',
        text: 'text-emerald-300',
        border: 'border-emerald-900/60',
        label: 'Live',
      }
    case 'closed':
      return {
        bg: 'bg-zinc-950',
        text: 'text-zinc-500',
        border: 'border-zinc-800',
        label: 'Closed',
      }
    case 'draft':
    default:
      return {
        bg: 'bg-zinc-900',
        text: 'text-zinc-400',
        border: 'border-zinc-800',
        label: 'Draft',
      }
  }
}

// Status enum on aa_03_marketing.email_sends.
export type SendStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'cancelled'
  | 'failed'

// Lightweight row returned by marketing_list_sends — no html_rendered.
export type SendListRow = {
  id: number
  name: string
  subject: string
  status: SendStatus
  segment_id: number | null
  segment_name: string | null
  total_recipients: number
  total_sent: number
  total_delivered: number
  total_opened: number
  total_bounced: number
  scheduled_for: string | null
  sending_started_at: string | null
  sent_at: string | null
  created_at: string
}

// Full row from marketing_get_send — adds html_rendered + the long-tail metrics.
export type SendDetailRow = SendListRow & {
  from_name: string | null
  from_address: string
  reply_to: string | null
  html_rendered: string | null
  segment_evaluation_id: number | null
  total_clicked: number
  total_complained: number
  total_unsubscribed: number
  created_by: string | null
  updated_at: string
}

// Picks a tone for the status badge in the History list / detail header.
export function sendStatusTone(s: SendStatus): {
  bg: string
  text: string
  border: string
  label: string
} {
  switch (s) {
    case 'sent':
      return {
        bg: 'bg-emerald-950',
        text: 'text-emerald-300',
        border: 'border-emerald-900/60',
        label: 'Sent',
      }
    case 'sending':
      return {
        bg: 'bg-amber-950',
        text: 'text-amber-300',
        border: 'border-amber-900/60',
        label: 'Sending…',
      }
    case 'scheduled':
      return {
        bg: 'bg-sky-950',
        text: 'text-sky-300',
        border: 'border-sky-900/60',
        label: 'Scheduled',
      }
    case 'draft':
      return {
        bg: 'bg-zinc-900',
        text: 'text-zinc-400',
        border: 'border-zinc-800',
        label: 'Draft',
      }
    case 'cancelled':
      return {
        bg: 'bg-zinc-950',
        text: 'text-zinc-500',
        border: 'border-zinc-800',
        label: 'Cancelled',
      }
    case 'failed':
      return {
        bg: 'bg-red-950',
        text: 'text-red-300',
        border: 'border-red-900/60',
        label: 'Failed',
      }
  }
}

// ISO-3166 alpha-2 set for the country_in filter. Curated for the
// markets we actually ship to — keeps the picker scannable and
// avoids dumping the entire ISO list on a user who's about to
// pick "GB" or "US" 95% of the time.
export const COUNTRY_OPTIONS: { code: string; name: string }[] = [
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'IE', name: 'Ireland' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'AT', name: 'Austria' },
  { code: 'PT', name: 'Portugal' },
  { code: 'PL', name: 'Poland' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'SG', name: 'Singapore' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'MX', name: 'Mexico' },
  { code: 'BR', name: 'Brazil' },
  { code: 'AR', name: 'Argentina' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'IN', name: 'India' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'IL', name: 'Israel' },
]

// Friendly labels for the campaign_engagement role dropdown.
export const ROLE_LABELS: Record<CampaignEngagementRole, string> = {
  signed_up: 'Signed up',
  backer: 'Backed (any channel)',
  signed_up_or_backer: 'Signed up or backed',
  backed_historic: 'Backed via historic platform',
  not_backer: "Hasn't backed",
  not_signed_up: "Hasn't signed up",
  none: 'No engagement',
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}
