'use client'

import './desktop.css'
import { ReactNode } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { DesktopSidebar } from './DesktopSidebar'
import { DesktopTopBar } from './DesktopTopBar'
import { DiscoverStage } from './DiscoverStage'
import { MyQuickyPanel } from './MyQuickyPanel'
import { DatingProfileCard } from './DatingProfileCard'
import { WhatsHappeningNow } from './WhatsHappeningNow'
import { useDashboard } from './useDashboard'

/**
 * Desktop command center (Desktop UI concept §3/§28/§53) — the three-zone
 * desktop architecture:
 *
 *   ┌ GLOBAL HEADER (DesktopTopBar) ┐
 *   ├ SIDEBAR │ PRIMARY CONTENT │ PERSONAL INSIGHTS ┤
 *   └ secondary content / live world ┘
 *
 * Mobile stays exactly as it is (§30) — AppRoot only mounts this shell at
 * ≥1024px and only for the five main tab views. The center stays the most
 * important area; on Discover the right side carries My Quicky + Recent
 * Activity, the dating profile sits under the stage, and the live-world
 * strip closes the page (§53 wireframe).
 */
export function DesktopHome({ children }: { children: ReactNode }) {
  const view = useQuickyStore((s) => s.view)
  const isDiscover = view === 'discovery'
  const { data, refresh } = useDashboard(isDiscover || view === 'profile-me')

  return (
    <div className="w-full h-full flex flex-col qk-desk-root" data-testid="desktop-shell">
      <DesktopTopBar />

      <div className="flex-1 min-h-0 flex">
        <DesktopSidebar />

        <main className="flex-1 min-w-0 min-h-0 relative">
          {isDiscover ? (
            <div className="w-full h-full overflow-y-auto qk-desk-scroll" data-testid="desktop-discover-page">
              <div className="flex items-start gap-6 max-w-[1200px] mx-auto px-8 pt-6">
                {/* Center — the most important area (§3) */}
                <div className="flex-1 min-w-0 flex flex-col items-center gap-8">
                  <DiscoverStage />
                  <DatingProfileCard />
                </div>
                {/* Personal insights — sticky right column (§11/§53) */}
                <aside className="hidden min-[1280px]:block w-[320px] shrink-0 sticky top-0">
                  <MyQuickyPanel dashboard={data} onRefresh={() => void refresh()} />
                </aside>
              </div>
              {/* Live world strip (§44) */}
              <div className="mt-6">
                <WhatsHappeningNow dashboard={data} />
              </div>
            </div>
          ) : (
            /* Other tabs plug into the same shell — their screens render
               in the center column at a comfortable width (§52). */
            <div className="w-full h-full max-w-[1080px] mx-auto">{children}</div>
          )}
        </main>
      </div>
    </div>
  )
}
