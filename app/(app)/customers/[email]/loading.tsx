import { SkeletonBlock, SkeletonKpiCards, SkeletonRows } from '@/components/Skeleton'

export default function Loading() {
  return (
    <div className="p-8">
      <SkeletonBlock className="h-3 w-24 mb-6" />
      <div className="mb-8">
        <SkeletonBlock className="h-8 w-2/5 mb-2" />
        <SkeletonBlock className="h-4 w-64" />
      </div>
      <SkeletonKpiCards count={3} />
      <SkeletonRows rows={6} />
    </div>
  )
}
