import { SkeletonBlock, SkeletonRows } from '@/components/Skeleton'

export default function Loading() {
  return (
    <div className="p-8">
      <SkeletonBlock className="h-8 w-40 mb-2" />
      <SkeletonBlock className="h-4 w-56 mb-6" />
      <div className="flex items-center gap-3 mb-6">
        <SkeletonBlock className="h-10 w-72 rounded-md" />
        <SkeletonBlock className="h-10 w-44 rounded-md" />
      </div>
      <SkeletonRows rows={12} />
    </div>
  )
}
