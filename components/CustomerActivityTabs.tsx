'use client'

import { useState, type ReactNode } from 'react'

type Tab = 'campaigns' | 'tickets'

// Tabbed shell for the customer detail screen — collapses the
// Campaigns Supported and Tickets sections into one container so they
// no longer stack down the page. Both panels are kept mounted (hidden
// rather than unmounted) so switching tabs doesn't blow CustomerCampaigns'
// expansion / fetched-orders state.
//
// Tabs are rendered as ReactNode slots so the parent server component can
// pre-render the ticket list while CustomerCampaigns stays as a client
// component — same pattern as CampaignDetailTabs.
export default function CustomerActivityTabs({
  campaignCount,
  ticketCount,
  campaignsSlot,
  ticketsSlot,
  defaultTab = 'campaigns',
}: {
  campaignCount: number
  ticketCount: number
  campaignsSlot: ReactNode
  ticketsSlot: ReactNode
  defaultTab?: Tab
}) {
  const [tab, setTab] = useState<Tab>(defaultTab)

  return (
    <div>
      <div className="flex items-center gap-2 mb-5" role="tablist">
        <TabButton
          active={tab === 'campaigns'}
          onClick={() => setTab('campaigns')}
          label="Campaigns"
          count={campaignCount}
        />
        <TabButton
          active={tab === 'tickets'}
          onClick={() => setTab('tickets')}
          label="Tickets"
          count={ticketCount}
        />
      </div>

      <div role="tabpanel" hidden={tab !== 'campaigns'}>
        {campaignsSlot}
      </div>
      <div role="tabpanel" hidden={tab !== 'tickets'}>
        {ticketsSlot}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`
        group relative flex items-center gap-2.5 px-5 py-2.5 rounded-full
        text-sm font-bold tracking-tight
        transition-all duration-150
        ${
          active
            ? 'bg-[#3B9EE8] text-white shadow-[0_0_0_1px_rgba(59,158,232,0.4),0_4px_20px_-4px_rgba(59,158,232,0.5)]'
            : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-white hover:border-zinc-700 hover:bg-zinc-800/60'
        }
      `}
    >
      <span>{label}</span>
      <span
        className={`
          inline-flex items-center justify-center
          min-w-[1.5rem] h-5 px-1.5 rounded-full
          text-[11px] font-bold tabular-nums
          ${
            active
              ? 'bg-white/20 text-white'
              : 'bg-zinc-800 text-zinc-400 group-hover:bg-zinc-700 group-hover:text-zinc-200'
          }
        `}
      >
        {count.toLocaleString()}
      </span>
    </button>
  )
}
