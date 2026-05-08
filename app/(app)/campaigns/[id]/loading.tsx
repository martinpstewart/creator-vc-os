import { SkeletonBlock, SkeletonKpiCards, SkeletonRows } from '@/components/Skeleton'

export default function Loading() {
  return (
    <div className="p-8">
      <SkeletonBlock className="h-3 w-24 mb-6" />
      <div className="mb-8">
        <SkeletonBlock className="h-8 w-2/5 mb-2" />
        <SkeletonBlock className="h-4 w-32" />
      </div>
      <SkeletonKpiCards count={4} />
      <SkeletonBlock className="h-3 w-16 mb-3" />
      <div className="flex gap-2 mb-8">
        <SkeletonBlock className="h-9 w-32 rounded-md" />
        <SkeletonBlock className="h-9 w-32 rounded-md" />
        <SkeletonBlock className="h-9 w-32 rounded-md" />
      </div>
      <div className="flex gap-2 mb-5">
        <SkeletonBlock className="h-10 w-32 rounded-full" />
        <SkeletonBlock className="h-10 w-32 rounded-full" />
      </div>
      <SkeletonRows rows={6} />
    </div>
  )
}
