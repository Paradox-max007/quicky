'use client'

import './desktop.css'
import { ReactNode } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { DesktopSidebar } from './DesktopSidebar'
import { DesktopTopBar } from './DesktopTopBar'
import { DiscoverStage } from './DiscoverStage'
import { DatingProfileCard } from './DatingProfileCard'
import { WhatsHappeningNow } from './WhatsHappeningNow'
import { WebPageShell } from './web-ui'
import { ChatsDesktop } from './ChatsDesktop'
import { GamesDesktop } from './GamesDesktop'
import { CommunityDesktop } from './CommunityDesktop'
import { LikesDesktop } from './LikesDesktop'
import { ProfileDesktop } from './ProfileDesktop'
import { SettingsDesktop } from './SettingsDesktop'
import { useDashboard } from './useDashboard'

/**
 * Desktop web shell (Web Premium PRD §2/§83):
 *
 *   ┌ TOP NAVIGATION  ← the ONLY primary navigation (§3/§76) ┐
 *   ├ CONTEXTUAL SIDEBAR │ PAGE CONTENT ┤
 *   └ (identity / progression / stats — zero nav links, §5/§75) ┘
 *
 * Each top-nav destination renders a dedicated desktop page: Discover keeps
 * the swipe stage (§44 — the sidebar IS the contextual left column), Chats
 * is the WhatsApp-style GameChatShell (§9/§67), Games is a full hub (§39),
 * Community an editorial feed (§20), Likes a 3-column grid (§27), Profile a
 * dedicated page (§33). Mobile/Capacitor never mount any of this (§65).
 */
export function DesktopHome({ children }: { children: ReactNode }) {
  const view = useQuickyStore((s) => s.view)
  const { data, loaded } = useDashboard(true)

  let page: ReactNode
  if (view === 'discovery') {
    // §44: left context = the sidebar; center = the card; right insights
    // ("About them") live inside DiscoverStage at ≥1280px.
    page = (
      <div className="w-full h-full overflow-y-auto qk-desk-scroll" data-testid="desktop-discover-page">
        <div className="max-w-[1600px] w-full mx-auto px-8 min-[1600px]:px-12 pt-6 pb-10">
          <div className="flex flex-col items-center gap-8">
            <DiscoverStage />
            <DatingProfileCard />
          </div>
          <div className="mt-6">
            <WhatsHappeningNow dashboard={data} />
          </div>
        </div>
      </div>
    )
  } else if (view === 'chats') {
    // §9/§67/§68: the chat page is a full-height two-pane shell — it does
    // NOT scroll as a page and gets no max-width container.
    page = <ChatsDesktop />
  } else if (view === 'games') {
    page = (
      <WebPageShell key="games" testId="desktop-games-page">
        <GamesDesktop />
      </WebPageShell>
    )
  } else if (view === 'community') {
    page = (
      <WebPageShell key="community" testId="desktop-community-page">
        <CommunityDesktop />
      </WebPageShell>
    )
  } else if (view === 'likes-you') {
    page = (
      <WebPageShell key="likes-you" testId="desktop-likes-page">
        <LikesDesktop />
      </WebPageShell>
    )
  } else if (view === 'profile-me') {
    page = (
      <WebPageShell key="profile-me" testId="desktop-profile-page">
        <ProfileDesktop />
      </WebPageShell>
    )
  } else if (view === 'settings') {
    // §37/§73: full-height nav|content architecture inside the shell
    page = <SettingsDesktop />
  } else {
    // Legacy tab render (e.g. the raw matches list) — same shell, same rules.
    page = (
      <WebPageShell key={view} testId="desktop-generic-page">
        {children}
      </WebPageShell>
    )
  }

  return (
    <div className="w-full h-full flex flex-col qk-desk-root" data-testid="desktop-shell">
      <DesktopTopBar />
      <div className="flex-1 min-h-0 flex">
        <DesktopSidebar data={data} loaded={loaded} />
        <main className="flex-1 min-w-0 min-h-0 relative">{page}</main>
      </div>
    </div>
  )
}
