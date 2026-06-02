import { Suspense } from 'react'
import { Home, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { withRetry } from '@/lib/supabase'
import ThirtyDayChart, { type TimelinePoint } from '@/components/ThirtyDayChart'
import StatsBarChart from '@/components/StatsBarChart'

export const dynamic = 'force-dynamic'

// ============================================================
// Wire shape returned by public.home_dashboard()
// ============================================================

type ProductRow = {
  product_name: string | null
  units: number
  revenue: number | string
  variant_count?: number
}
// TimelinePoint is the chart's per-day data point — imported from the
// shared component so the type stays in one place.
type ChannelData = {
  orders: number
  customers: number
  revenue: number | string
  units: number
  products: ProductRow[]
  timeline: TimelinePoint[]
  // Only present on the Legacy Platforms block (drives the bar-chart
  // visual). Optional so the other channels' types stay clean.
  distinct_products?: number
}
type Combined = {
  orders: number
  customers: number
  revenue: number | string
  units: number
}
type Payload = {
  combined: Combined
  shopify: ChannelData
  gumroad: ChannelData
  shopify_legacy: ChannelData
}

// ============================================================
// Fetch — single RPC, server-side aggregation. ~880ms cold; the
// spinner under <Suspense> covers it. We deliberately don't wrap
// this in unstable_cache because the auth-aware SSR client reads
// cookies(), which isn't allowed inside cached functions — a
// stateless anon-key client would be required to cache safely.
// Re-add if cold-hit latency becomes a problem.
// ============================================================

// Returns null on error — `home_dashboard` is admin-gated server-side and
// raises `forbidden: admin only` for team/support callers. The middleware
// redirects non-admins before they reach this page, so a null result here
// almost certainly means Postgres is down rather than RBAC bouncing us.
async function getHomeDashboard(): Promise<Payload | null> {
  try {
    return await withRetry(async () => {
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('home_dashboard')
      if (error) throw new Error(error.message)
      return data as Payload
    }, 'getHomeDashboard')
  } catch (e) {
    // Both attempts failed — render the "unavailable" card rather than
    // throw into the error boundary. Home is admin-only; non-admins
    // never get here.
    console.error('[home_dashboard]', e)
    return null
  }
}

// ============================================================
// Formatting
// ============================================================

const intl = new Intl.NumberFormat('en-US')
function fmtInt(n: number | string | null | undefined): string {
  if (n == null) return '—'
  const v = typeof n === 'string' ? Number(n) : n
  if (!Number.isFinite(v)) return '—'
  return intl.format(v)
}
function fmtUsd(n: number | string | null | undefined, withCents = false): string {
  if (n == null) return '—'
  const v = typeof n === 'string' ? Number(n) : n
  if (!Number.isFinite(v)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: withCents ? 2 : 0,
  }).format(v)
}

// ============================================================
// Page — header paints immediately, dashboard streams under Suspense
// ============================================================

export default function HomePage() {
  return (
    <div className="p-4 md:p-8">
      <header className="mb-6 md:mb-8 flex items-center gap-3">
        <span className="inline-flex items-center justify-center w-9 h-9 md:w-10 md:h-10 rounded-lg bg-[#3B9EE8]">
          <Home size={18} className="text-white" strokeWidth={2.25} />
        </span>
        <h1 className="text-xl md:text-2xl font-semibold text-white">Home</h1>
      </header>

      <Suspense fallback={<HomeSkeleton />}>
        <DashboardBody />
      </Suspense>
    </div>
  )
}

async function DashboardBody() {
  const data = await getHomeDashboard()
  if (!data) return <DashboardUnavailable />
  // Compute AOV from combined revenue/orders. Cheap derived number.
  const aov =
    Number(data.combined.revenue) > 0 && data.combined.orders > 0
      ? Number(data.combined.revenue) / data.combined.orders
      : 0

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Headline row — combined across every channel (Shopify + Gumroad
          + Legacy Platforms + ISOD). The customer count comes from the
          canonical aa_02_crm.v_paying_customer_emails view; revenue and
          orders are the sum of the three channel columns below. */}
      <section>
        <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-2">
          All-time · All channels
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
          <HeadlineTile label="Customers"   value={fmtInt(data.combined.customers)} />
          <HeadlineTile label="Orders"      value={fmtInt(data.combined.orders)} />
          <HeadlineTile label="Units sold"  value={fmtInt(data.combined.units)} />
          <HeadlineTile label="Gross intake" value={fmtUsd(data.combined.revenue)} />
          <HeadlineTile label="Avg order"   value={fmtUsd(aov)} />
        </div>
      </section>

      {/* Per-channel breakdown — three columns once shopify_legacy is in. On
          wide screens we still get a clean row; on tablet the third wraps. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
        <ChannelColumn title="Shopify" data={data.shopify} />
        <ChannelColumn title="Gumroad" data={data.gumroad} />
        <ChannelColumn
          title="Legacy Platforms"
          data={data.shopify_legacy}
          channelKey="legacy_platforms"
          tooltip="All historic-import data — Shopify (legacy), Gumroad CSV, Wix. Each live channel above tracks only its own ongoing activity; everything imported from a CSV lives here."
          variant="legacy"
        />
      </div>
    </div>
  )
}

function DashboardUnavailable() {
  // Shown if home_dashboard() returned null — almost always a transient
  // Postgres / network blip. The card is intentionally neutral so a
  // mis-routed non-admin (shouldn't happen given middleware) sees a
  // sensible message rather than a stack trace.
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 md:p-8 text-sm text-zinc-400">
      <p className="font-medium text-white mb-1">Dashboard unavailable</p>
      <p>The dashboard data couldn&apos;t be loaded. Try refreshing in a moment.</p>
    </div>
  )
}

function HeadlineTile({ label, value }: { label: string; value: string }) {
  // Uniform "premium" treatment: navy-blue → near-black flare from
  // the top-left, faint blue border. Just the eyebrow label + big number.
  return (
    <div className="relative overflow-hidden rounded-xl border border-[#3B9EE8]/40 bg-gradient-to-br from-[#0e2740] via-zinc-900 to-zinc-900 p-4 md:p-5">
      <p className="text-[10px] md:text-[11px] uppercase tracking-wide font-semibold text-[#7ec3ee]">
        {label}
      </p>
      <p className="mt-2 font-bold tabular-nums leading-tight text-white text-xl sm:text-2xl xl:text-3xl break-words">
        {value}
      </p>
    </div>
  )
}

// ============================================================
// Loading state — centered spinner + ghost tile outlines so the
// final layout doesn't visibly jump when data arrives.
// ============================================================

function HomeSkeleton() {
  return (
    <div className="space-y-6 md:space-y-8">
      {/* Headline row ghost */}
      <div>
        <div className="h-3 w-44 rounded bg-zinc-900 border border-zinc-800 mb-2" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5 h-[100px] md:h-[120px]"
            />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
        <SkeletonColumn />
        <SkeletonColumn />
        <SkeletonColumn />
      </div>
      <div className="flex items-center justify-center gap-2 text-xs text-zinc-500 -mt-2">
        <Loader2 size={14} className="animate-spin text-[#3B9EE8]" />
        Crunching the numbers…
      </div>
    </div>
  )
}

function SkeletonColumn() {
  return (
    <section className="space-y-3 md:space-y-4">
      <div className="h-6 w-32 rounded bg-zinc-900 border border-zinc-800" />
      <div className="grid grid-cols-2 gap-3 md:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5 h-[92px] md:h-[112px]" />
        ))}
      </div>
      {/* Chart ghost */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl h-[200px]" />
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl h-[420px]" />
    </section>
  )
}

// ============================================================
// View components
// ============================================================

function ChannelColumn({
  title,
  data,
  channelKey,
  tooltip,
  variant = 'live',
}: {
  title: string
  data: ChannelData
  channelKey?: string
  tooltip?: string
  // 'live' uses the 30-day line chart (live channels accumulate
  // activity over time); 'legacy' uses the 3-metric bar chart since
  // historic-import data is static — a trend line would be flat.
  variant?: 'live' | 'legacy'
}) {
  return (
    <section className="space-y-3 md:space-y-4">
      <h2
        className="text-base md:text-lg font-semibold text-white inline-flex items-center gap-1.5"
        title={tooltip}
      >
        {title}
        {tooltip && (
          <span
            aria-label="more info"
            className="inline-flex w-3.5 h-3.5 items-center justify-center rounded-full bg-zinc-800 text-zinc-500 text-[9px] font-bold cursor-help"
          >
            i
          </span>
        )}
      </h2>

      <div className="grid grid-cols-2 gap-3 md:gap-4">
        <StatTile label="Orders"           value={fmtInt(data.orders)}    sub="paid only" />
        <StatTile label="Unique customers" value={fmtInt(data.customers)} sub="distinct email" />
        <StatTile label="Revenue"          value={fmtUsd(data.revenue)}   sub="USD gross" />
        <StatTile label="Units"            value={fmtInt(data.units)}     sub="sum of quantity" />
      </div>

      {variant === 'legacy' ? (
        <StatsBarChart
          customers={Number(data.customers ?? 0)}
          products={Number(data.distinct_products ?? 0)}
          revenue={Number(data.revenue ?? 0)}
        />
      ) : (
        <ThirtyDayChart
          data={data.timeline ?? []}
          idKey={channelKey ?? title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
          subtitle="Orders per day"
          unitNoun="order"
        />
      )}

      <TopProducts products={data.products ?? []} />
    </section>
  )
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5">
      <p className="text-[11px] md:text-xs text-zinc-500 uppercase tracking-wide font-medium">
        {label}
      </p>
      <p className="text-xl md:text-3xl font-semibold text-white mt-2 tabular-nums">{value}</p>
      <p className="text-[10px] md:text-xs text-zinc-600 mt-1">{sub}</p>
    </div>
  )
}

function TopProducts({ products }: { products: ProductRow[] }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 md:px-5 py-3 border-b border-zinc-800">
        <p className="text-xs md:text-sm font-semibold text-white">Top products</p>
        <p className="text-[10px] md:text-xs text-zinc-500 mt-0.5">
          Top 10 by units, rolled up across variants. Revenue is gross.
        </p>
      </div>
      {products.length === 0 ? (
        <p className="px-4 md:px-5 py-6 text-xs text-zinc-500">No products yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/40">
                <th className="text-left px-4 md:px-5 py-2 text-[10px] md:text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                  Product
                </th>
                <th className="text-right px-2 py-2 text-[10px] md:text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                  Units
                </th>
                <th className="text-right px-4 md:px-5 py-2 text-[10px] md:text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => (
                <tr key={i} className="border-b border-zinc-800/50 last:border-0">
                  <td className="px-4 md:px-5 py-2 text-zinc-200" title={p.product_name ?? ''}>
                    <span className="truncate max-w-[180px] md:max-w-[260px] inline-block align-middle">
                      {p.product_name ?? '—'}
                    </span>
                    {p.variant_count != null && p.variant_count > 1 && (
                      <span className="ml-2 text-[10px] text-zinc-600 align-middle whitespace-nowrap">
                        {p.variant_count} variants
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right text-zinc-200 tabular-nums">{fmtInt(p.units)}</td>
                  <td className="px-4 md:px-5 py-2 text-right text-zinc-300 tabular-nums">
                    {fmtUsd(p.revenue, true)}
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
