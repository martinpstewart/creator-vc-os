import { Sparkles } from 'lucide-react'
import QueryConsole from '@/components/QueryConsole'

export const dynamic = 'force-dynamic'

export default function QueryPage() {
  return (
    <div className="p-4 md:p-8 max-w-[1400px]">
      <header className="mb-6 flex items-center gap-3">
        <span className="inline-flex items-center justify-center w-9 h-9 md:w-10 md:h-10 rounded-lg bg-[#3B9EE8]">
          <Sparkles size={18} className="text-white" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-white">Ask</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Plain-English questions over the order &amp; backer data. Templates first, AI fallback if nothing fits.
          </p>
        </div>
      </header>
      <QueryConsole />
    </div>
  )
}
