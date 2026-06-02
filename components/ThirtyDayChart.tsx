'use client'

// Reusable 30-day line chart. Inline SVG, zero deps.
//
// Tooltip strategy: we used to lean on the native SVG <title> element,
// which is the spec-correct "hover for tooltip" hook — but it's flaky
// in practice (~1s browser delay, inconsistent across engines, dead on
// mobile, and especially unreliable on viewBox-scaled SVGs). The chart
// now tracks the hovered point in React state and renders a tooltip
// group at the hovered dot — instant, consistent, and tap-on-mobile.
//
// Switching to a client component is the cost; it's a tiny render tree
// so the extra hydration is negligible.

import { useState } from 'react'

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
  // Index of the currently-hovered (or tapped) point, or null. Sits at
  // the top of the component so it can short-circuit early.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

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

  // Build the tooltip strings once per hover so the render below stays
  // declarative. Done up here so we can also pre-measure widths.
  const hovered = hoverIdx != null ? data[hoverIdx] : null
  const hoveredXY = hoverIdx != null ? points[hoverIdx] : null
  const hoverDate = hovered ? fmtDateLabel(hovered.date) : ''
  const hoverValue = hovered
    ? `${fmtInt(hovered.count)} ${unitNoun}${hovered.count === 1 ? '' : 's'}`
    : ''
  // Cheap width estimate — proportional to character count. The SVG
  // scales to the container so a rough estimate is fine; we just need
  // the rect wide enough that the longest of the two lines fits.
  const tooltipW = Math.max(hoverDate.length, hoverValue.length) * 5.5 + 16
  const tooltipH = 30

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
          // Clearing on the svg means moving off the chart entirely
          // dismisses the tooltip even if the cursor exits via a gap
          // between hit-circles.
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#3B9EE8" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#3B9EE8" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradId})`} />
          <path d={linePath} fill="none" stroke="#3B9EE8" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {/* Visible dots — full brightness on real activity, faint marker on
              zero days so the day still has a target you can hover. Highlight
              ring on the currently-hovered point. */}
          {data.map((d, i) => {
            const [cx, cy] = points[i]
            const isActive = i === hoverIdx
            const r = isActive ? 3.5 : d.count > 0 ? 2.5 : 1.25
            const op = d.count > 0 || isActive ? 1 : 0.35
            return (
              <circle
                key={`dot-${i}`}
                cx={cx}
                cy={cy}
                r={r}
                fill="#3B9EE8"
                opacity={op}
                pointerEvents="none"
              />
            )
          })}

          {/* Hit targets — separate pass so they all sit above the dots
              and tooltip line for the entire row, and never get masked
              by the line / area paths. */}
          {data.map((d, i) => {
            const [cx, cy] = points[i]
            return (
              <circle
                key={`hit-${i}`}
                cx={cx}
                cy={cy}
                r="10"
                fill="transparent"
                // No special cursor — the live tooltip is its own
                // affordance, and the previous cursor-help (arrow with
                // a `?`) was a leftover from the native-<title> era.
                onMouseEnter={() => setHoverIdx(i)}
                onTouchStart={(e) => {
                  // Mobile: tap-to-show. Prevent the synthetic mouse
                  // event so we don't get a re-fire that confuses state
                  // on tap-twice-to-dismiss.
                  e.preventDefault()
                  setHoverIdx(i === hoverIdx ? null : i)
                }}
              />
            )
          })}

          {labelIdxs.map((i) => (
            <text
              key={`xlabel-${i}`}
              x={xScale(i)}
              y={H - 8}
              fontSize="10"
              fill="#71717a"
              textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
            >
              {fmtDateLabel(data[i].date)}
            </text>
          ))}

          {/* Tooltip — rendered last so it sits above everything else.
              Positioned above the hovered dot, with the rect clamped to
              the viewBox bounds so it doesn't get cut off at the edges. */}
          {hovered && hoveredXY && (
            <g pointerEvents="none">
              {/* Vertical guide from the dot up to the tooltip's bottom edge. */}
              <line
                x1={hoveredXY[0]}
                x2={hoveredXY[0]}
                y1={hoveredXY[1]}
                y2={Math.max(hoveredXY[1] - 14, PAD_TOP + tooltipH + 4)}
                stroke="#52525b"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              {(() => {
                // Centre the rect over the dot; clamp to the chart's
                // horizontal padding so the tooltip never spills past
                // the visible plot area.
                const rectX = Math.max(
                  PAD_X,
                  Math.min(W - PAD_X - tooltipW, hoveredXY[0] - tooltipW / 2),
                )
                // Prefer above the dot. If the dot is very high (low Y),
                // fall through and pin to the top padding band.
                const rectY = Math.max(PAD_TOP, hoveredXY[1] - tooltipH - 8)
                return (
                  <>
                    <rect
                      x={rectX}
                      y={rectY}
                      width={tooltipW}
                      height={tooltipH}
                      rx={5}
                      ry={5}
                      fill="#18181b"
                      stroke="#3f3f46"
                      strokeWidth="1"
                    />
                    <text
                      x={rectX + tooltipW / 2}
                      y={rectY + 12}
                      fontSize="9"
                      fill="#a1a1aa"
                      textAnchor="middle"
                    >
                      {hoverDate}
                    </text>
                    <text
                      x={rectX + tooltipW / 2}
                      y={rectY + 24}
                      fontSize="10"
                      fontWeight="600"
                      fill="#ffffff"
                      textAnchor="middle"
                    >
                      {hoverValue}
                    </text>
                  </>
                )
              })()}
            </g>
          )}
        </svg>
      </div>
    </div>
  )
}
