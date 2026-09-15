'use client'

import { useQuickyStore } from '@/store/quicky'
import { ChevronRight } from 'lucide-react'
import { DashboardData } from './useDashboard'

/**
 * "WHAT'S HAPPENING NOW" strip (concept doc §44/§24/§25/§45): real live
 * numbers only — active Spin the Bottle rooms with seated players, running
 * 1v1 games, community presence. Turns the dashboard into a living world
 * and gives the user one-click entry into each (§47 personalized home will
 * build on this).
 */

function Tile({
  emoji,
  title,
  lines,
  cta,
  onClick,
  testid,
}: {
  emoji: string
  title: string
  lines: string[]
  cta: string
  onClick: () => void
  testid?: string
}) {
  return (
    <button
      onClick={onClick}
      className="qk-desk-stat flex-1 min-w-[200px] rounded-2xl border border-white/8 bg-[var(--qk-card)]/60 px-4 py-4 text-left group"
      data-testid={testid}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-lg leading-none">{emoji}</span>
        <span className="text-xs font-bold tracking-widest uppercase text-white/80">{title}</span>
      </div>
      {lines.map((l, i) => (
        <p key={i} className="text-[11px] text-white/50 leading-snug">
          {l}
        </p>
      ))}
      <span className="mt-2.5 inline-flex items-center gap-0.5 text-xs font-bold text-[var(--qk-accent)] group-hover:text-[var(--qk-accent-light)] transition-colors">
        {cta}
        <ChevronRight className="w-3.5 h-3.5" />
      </span>
    </button>
  )
}

export function WhatsHappeningNow({ dashboard }: { dashboard: DashboardData | null }) {
  const setView = useQuickyStore((s) => s.setView)
  const live = dashboard?.live ?? null

  return (
    <section className="px-8 pb-8 pt-2 max-w-[1200px] mx-auto w-full" data-testid="desktop-whats-happening">
      <p className="text-[11px] font-bold tracking-widest text-white/40 uppercase mb-3">What's Happening Now</p>
      <div className="flex flex-wrap gap-3">
        <Tile
          emoji="🍾"
          title="Spin the Bottle"
          lines={[
            live ? `${live.rooms} room${live.rooms === 1 ? '' : 's'} active` : 'Live rooms',
            live && live.players > 0 ? `${live.players} player${live.players === 1 ? '' : 's'} seated` : 'Someone might be waiting for you...',
          ]}
          cta="Play now"
          onClick={() => setView('spin-bottle')}
          testid="tile-spin"
        />
        <Tile
          emoji="🎮"
          title="Live Games"
          lines={[
            live ? `${live.activeGames} game${live.activeGames === 1 ? '' : 's'} running with you` : 'Truth or Dare, NHIE and more',
            'Played inside your chats',
          ]}
          cta="Open chats"
          onClick={() => setView('matches')}
          testid="tile-games"
        />
        <Tile
          emoji="👥"
          title="Community"
          lines={[
            live ? `${live.online} people online now` : 'People online now',
            live && live.postsToday > 0 ? `${live.postsToday} new post${live.postsToday === 1 ? '' : 's'} today` : 'Posts, rolls and rooms',
          ]}
          cta="Open community"
          onClick={() => setView('community')}
          testid="tile-community"
        />
      </div>
    </section>
  )
}
