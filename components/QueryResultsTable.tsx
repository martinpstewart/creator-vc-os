'use client'

import { useMemo, useState } from 'react'

type Row = Record<string, unknown>

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function compare(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const an = Number(a), bn = Number(b)
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn
  return String(a).localeCompare(String(b))
}

export default function QueryResultsTable({
  rows,
  columns,
}: {
  rows: Row[]
  columns: string[]
}) {
  const [sortBy, setSortBy] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null)
  const [filter, setFilter] = useState('')

  const filteredSorted = useMemo(() => {
    let out = rows
    if (filter.trim()) {
      const needle = filter.toLowerCase()
      out = out.filter((r) => columns.some((c) => cellToString(r[c]).toLowerCase().includes(needle)))
    }
    if (sortBy) {
      const { col, dir } = sortBy
      out = [...out].sort((a, b) => (dir === 'asc' ? compare(a[col], b[col]) : compare(b[col], a[col])))
    }
    return out
  }, [rows, columns, filter, sortBy])

  function toggleSort(col: string) {
    setSortBy((prev) => {
      if (!prev || prev.col !== col) return { col, dir: 'asc' }
      if (prev.dir === 'asc') return { col, dir: 'desc' }
      return null
    })
  }

  if (rows.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-12 text-center text-sm text-zinc-500">
        No rows returned.
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-3">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter rows…"
          className="flex-1 max-w-xs bg-zinc-950 border border-zinc-800 rounded-md px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        <span className="text-xs text-zinc-500 tabular-nums">
          {filteredSorted.length.toLocaleString()} of {rows.length.toLocaleString()}
        </span>
      </div>
      <div className="overflow-auto max-h-[60vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-zinc-900 z-10">
            <tr className="border-b border-zinc-800">
              {columns.map((col) => {
                const sorted = sortBy?.col === col
                return (
                  <th
                    key={col}
                    onClick={() => toggleSort(col)}
                    className="text-left px-4 py-2.5 text-xs font-medium text-zinc-400 cursor-pointer select-none hover:text-white whitespace-nowrap"
                  >
                    <span className="inline-flex items-center gap-1">
                      {col}
                      {sorted && <span className="text-[#3B9EE8]">{sortBy.dir === 'asc' ? '↑' : '↓'}</span>}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {filteredSorted.map((r, i) => (
              <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                {columns.map((c) => {
                  const v = r[c]
                  const display = cellToString(v)
                  return (
                    <td
                      key={c}
                      className="px-4 py-2 text-zinc-300 whitespace-nowrap max-w-[400px] overflow-hidden text-ellipsis"
                      title={display}
                    >
                      {display || <span className="text-zinc-600">—</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
