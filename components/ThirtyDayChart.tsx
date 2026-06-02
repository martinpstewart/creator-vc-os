// Reusable 30-day line chart. Inline SVG, zero deps. Server-renderable
// (no 'use client' — it's static markup). Originally lived in the home
// dashboard; pulled out so the Tickets screen can reuse the same look.
//
// The visible dot scales with activity so quiet days still have a
// hoverable target, and a generous invisible hit-circle sits over each
// point so the native title tooltip is easy to land on.

export type TimelinePoint = { date: string; count: number }

const intl = new Intl.NumberFormat('en-US')
function fmtInt(n: number): string {
  return intl.format(n)
}

export default function ThirtyDayChart({
  data,
  idKey,
  subtitle,
  unitNoun = 'event',
  emptyLabel = 'No activity in the last 30 days.',
}: {
  data: TimelinePoint[]
  // Unique per chart instance so the SVG gradient id doesn't collide
  // when two charts share a page.
  idKey: string
  // Caption under the "Last 30 days" header (e.g. "Orders per day").
  subtitle: string
  // Singular noun used in the per-day tooltip — pluralised by appending 's'.
  unitNoun?: string
  emptyLabel?: string
}) {
  if (data.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-6 text-xs text-zinc-500">
        {emptyLabel}
      </div>
    )
  }

  const W = 600
  const H = 130
  const PAD_X = 12
  const PAD_TOP = 10
  const PAD_BOTTOM = 26
  const max = Math.max(...data.map((d) => d.count), 1)

  const xScale = (i: number) =>
    PAD_X + (i * (W - 2 * PAD_X)) / Math.max(data.length - 1, 1)
  const yScale = (v: number) =>
    H - PAD_BOTTOM - (v / max) * (H - PAD_TOP - PAD_BOTTOM)

  const points: ReadonlyArray<readonly [number, number]> = data.map(
    (d, i) => [xScale(i), yScale(d.count)] as const,
  )
  const linePath = points
    .map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`))
    .join(' ')
  const areaPath = `${linePath} L${xScale(data.length - 1)},${H - PAD_BOTTOM} L${xScale(0)},${H - PAD_BOTTOM} Z`

  const gradId = `cvc-area-${idKey}`

  const total = data.reduce((s, d) => s + d.count, 0)
  const labelIdxs = [0, Math.floor(data.length / 2), data.length - 1]
  const fmtDateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="px-4 md:px-5 py-3 border-b border-zinc-800 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs md:text-sm font-semibold text-white">Last 30 days</p>
          <p className="text-[10px] md:text-xs text-zinc-500 mt-0.5">{subtitle}</p>
        </div>
        <p className="text-lg md:text-2xl font-bold tabular-nums text-white">{fmtInt(total)}</p>
      </div>
      <div className="px-3 py-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-32"
          preserveAspectRatio="none"
          aria-label={`${idKey} 30-day ${unitNoun} timeline`}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#3B9EE8" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#3B9EE8" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradId})`} />
          <path d={linePath} fill="none" stroke="#3B9EE8" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {data.map((d, i) => {
            const [cx, cy] = points[i]
            // Visible dot — full brightness on real activity, faint marker on
            // zero days so the day still has a target you can hover.
            const r = d.count > 0 ? 2.5 : 1.25
            const op = d.count > 0 ? 1 : 0.35
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r={r} fill="#3B9EE8" opacity={op} />
                {/* Generous invisible hit target so the dot is hoverable
                    even on small bumps where the visible circle is tiny. */}
                <circle cx={cx} cy={cy} r="9" fill="transparent" className="cursor-help">
                  <title>
                    {fmtDateLabel(d.date)}: {fmtInt(d.count)} {unitNoun}
                    {d.count === 1 ? '' : 's'}
                  </title>
                </circle>
              </g>
            )
          })}
          {labelIdxs.map((i) => (
            <text
              key={i}
              x={xScale(i)}
              y={H - 8}
              fontSize="10"
              fill="#71717a"
              textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
            >
              {fmtDateLabel(data[i].date)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  )
}
