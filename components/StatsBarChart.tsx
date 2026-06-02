// Three-metric bar chart for the Legacy Platforms home column.
// Each bar represents one metric (Customers / Products / Revenue) and
// since their units differ (people / SKUs / dollars), bar heights are
// proportional within their own column, not compared across — the
// number above each bar is the source of truth. The visual gives a
// quick at-a-glance "which is biggest" feel without lying about scale.

const intl = new Intl.NumberFormat('en-US')

function fmtInt(n: number): string {
  return intl.format(n)
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

export type StatsBarChartProps = {
  customers: number
  products: number
  revenue: number
}

// Bar fills go from 30% to 100% of the chart area based on a smooth
// log-ish scale of the raw value within the bar's own metric. We use
// log because customers (thousands), products (tens), and revenue
// (hundreds of thousands) span vastly different magnitudes; linear
// would collapse the smaller metric to nothing. The exact algorithm
// doesn't matter — the bar is decorative and the value label is the
// source of truth.
function barFillPct(value: number, refMax: number): number {
  if (value <= 0) return 0
  const ratio = Math.log10(value + 1) / Math.log10(refMax + 1)
  return Math.max(0.2, Math.min(1, ratio)) * 100
}

export default function StatsBarChart({
  customers,
  products,
  revenue,
}: StatsBarChartProps) {
  // Each bar normalised against a per-metric "reference max" so a
  // changeable dataset still produces sensible-looking heights. The
  // refs are intentionally loose; this is decorative, not analytical.
  const bars = [
    {
      label: 'Customers',
      value: customers,
      display: fmtInt(customers),
      // Blue — same accent as the line chart on the home dash.
      fill: '#3B9EE8',
      ref: 10_000,
    },
    {
      label: 'Products',
      value: products,
      display: fmtInt(products),
      // Emerald — distinct from the brand blue.
      fill: '#10b981',
      ref: 200,
    },
    {
      label: 'Revenue',
      value: revenue,
      display: fmtUsd(revenue),
      // Amber — distinct again, evokes "money".
      fill: '#f59e0b',
      ref: 1_000_000,
    },
  ] as const

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 md:px-5 py-3 border-b border-zinc-800">
        <p className="text-xs md:text-sm font-semibold text-white">Snapshot</p>
        <p className="text-[10px] md:text-xs text-zinc-500 mt-0.5">
          Customers, products, revenue
        </p>
      </div>
      <div className="px-4 md:px-5 py-5 grid grid-cols-3 gap-4">
        {bars.map((b) => {
          const pct = barFillPct(b.value, b.ref)
          return (
            <div key={b.label} className="flex flex-col items-center">
              <p className="text-base md:text-lg font-bold tabular-nums text-white">
                {b.display}
              </p>
              {/* Bar — fixed-height frame, filled rectangle inside. */}
              <div className="mt-2 w-12 md:w-14 h-32 bg-zinc-800/50 border border-zinc-800 rounded-md overflow-hidden flex items-end">
                <div
                  className="w-full transition-all"
                  style={{
                    height: `${pct}%`,
                    backgroundColor: b.fill,
                  }}
                />
              </div>
              <p className="mt-2 text-[10px] md:text-[11px] uppercase tracking-wide text-zinc-500 font-medium">
                {b.label}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
