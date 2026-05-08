import Sidebar from './Sidebar'
import MobileTopBar from './MobileTopBar'
import BottomNav from './BottomNav'

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Mobile-only chrome */}
      <MobileTopBar />

      {/* Desktop sidebar (hidden below md) */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Main content. pb-20 on mobile leaves room for the fixed bottom nav. */}
      <main className="flex-1 overflow-auto min-w-0 pb-20 md:pb-0">{children}</main>

      <BottomNav />
    </div>
  )
}
