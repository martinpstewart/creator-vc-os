export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`bg-zinc-800/60 rounded-md animate-pulse ${className}`} />
}

export function SkeletonKpiCards({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid gap-4 mb-8`} style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <SkeletonBlock className="h-3 w-24 mb-3" />
          <SkeletonBlock className="h-7 w-32" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonRows({ rows = 8 }: { rows?: number }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/50 last:border-0">
          <div className="flex-1">
            <SkeletonBlock className="h-4 w-2/5 mb-2" />
            <SkeletonBlock className="h-3 w-1/4" />
          </div>
          <SkeletonBlock className="h-4 w-16" />
        </div>
      ))}
    </div>
  )
}
