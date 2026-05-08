import QueryConsole from '@/components/QueryConsole'

export const dynamic = 'force-dynamic'

export default function QueryPage() {
  return (
    <div className="p-4 md:p-8 max-w-[1400px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold text-white">Ask</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Plain-English questions over the order &amp; backer data. Templates first, AI fallback if nothing fits.
        </p>
      </div>
      <QueryConsole />
    </div>
  )
}
