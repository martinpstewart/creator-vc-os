import { redirect } from 'next/navigation'
import { Settings } from 'lucide-react'
import { createClient } from '@/lib/supabase-server'
import { isOwner } from '@/lib/auth'
import AcutrackImportForm from '@/components/AcutrackImportForm'

export const dynamic = 'force-dynamic'

// Owner-only operations area. Today this is just the Acutrack CSV
// import (the partner has no API, so we periodically dump their
// OrderExportReport_*.csv and replace the canonical received-orders
// set in Supabase). The wipe-and-replace nature of that flow is why
// it's scoped to a single human even though other admins exist —
// it'd be too easy for two admins to step on each other's exports.
export default async function SettingsPage() {
  // Middleware admits all admins to /settings (the screen is in the
  // admin ACCESS array). The owner check below is the actual gate;
  // non-Martin admins get bounced back to /.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!isOwner(user?.email)) redirect('/')

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <header className="mb-6 md:mb-8 flex items-center gap-3">
        <span className="inline-flex items-center justify-center w-9 h-9 md:w-10 md:h-10 rounded-lg bg-[#3B9EE8]">
          <Settings size={18} className="text-white" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-white">Settings</h1>
          <p className="text-sm text-zinc-500 mt-1">Admin-only operational tools.</p>
        </div>
      </header>

      <section className="space-y-6">
        <AcutrackImportForm />
      </section>
    </div>
  )
}
