import { SkeletonBlock, SkeletonRows } from '@/components/Skeleton'

export default function Loading() {
  return (
    <div className="p-8">
      <SkeletonBlock className="h-8 w-40 mb-2" />
      <SkeletonBlock className="h-4 w-56 mb-8" />
      <SkeletonRows rows={10} />
    </div>
  )
}
