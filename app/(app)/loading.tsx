import { SkeletonBlock, SkeletonKpiCards, SkeletonRows } from '@/components/Skeleton'

export default function Loading() {
  return (
    <div className="p-8">
      <SkeletonBlock className="h-8 w-48 mb-2" />
      <SkeletonBlock className="h-4 w-64 mb-8" />
      <SkeletonKpiCards count={4} />
      <div className="flex gap-2 mb-5">
        <SkeletonBlock className="h-10 w-36 rounded-full" />
        <SkeletonBlock className="h-10 w-36 rounded-full" />
      </div>
      <SkeletonRows rows={8} />
    </div>
  )
}
