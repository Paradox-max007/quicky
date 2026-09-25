'use client'

// Quicky — MOBILE GAMES HUB (Game Hub PRD §8-§11/§65/§68-§70)
// A dedicated full screen of game cards rendered FROM the GameDefinition
// catalog (never hardcoded, §11). Exactly 2 cards per row (§9), the whole
// card tappable (§69), honest LIVE / SOON statuses (§59), real empty state
// (§70). Tap a card → that game's landing page.

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, ArrowLeft } from 'lucide-react'
import { useQuickyStore } from '@/store/quicky'
import { useGames } from './game-hub/useGames'
import { GameCard } from './game-hub/GameCard'
import { GamesFilterBar } from './game-hub/GamesFilterBar'
import { PointsBadges } from './realm/PointsBadges'
import { CratesBanner } from './pass/CratesBanner'

export function GamesScreen() {
  const setView = useQuickyStore((s) => s.setView)
  const openGameLanding = useQuickyStore((s) => s.openGameLanding)
  const gamesReturnView = useQuickyStore((s) => s.gamesReturnView)
  const setGamesReturnView = useQuickyStore((s) => s.setGamesReturnView)
  const { games, loaded, failed, retry } = useGames()

  // Refactor PRD §89 — hub filters: All / Party / 2 Player / Coming Soon.
  const [gamesFilter, setGamesFilter] = useState<'all' | 'party' | 'two' | 'soon'>('all')
  const filtered = (() => {
    if (!games) return games
    if (gamesFilter === 'party') return games.filter((g) => g.supportedModes === 'GROUP' || g.supportedModes === 'BOTH')
    if (gamesFilter === 'two') return games.filter((g) => g.supportedModes === 'TWO_PLAYER' || g.supportedModes === 'BOTH')
    if (gamesFilter === 'soon') return games.filter((g) => !g.isPlayable)
    return games
  })()

  const open = (slug: string) => openGameLanding(slug)

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white relative overflow-hidden">
      {/* Ambient glow blobs — cheap, slow, pointer-safe */}
      <motion.div
        className="pointer-events-none absolute -top-20 -left-20 w-64 h-64 rounded-full bg-[var(--qk-accent)]/15 blur-3xl"
        animate={{ x: [0, 30, 0], y: [0, 20, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        aria-hidden
      />
      <motion.div
        className="pointer-events-none absolute -bottom-24 -right-20 w-72 h-72 rounded-full bg-[var(--qk-purple)]/15 blur-3xl"
        animate={{ x: [0, -30, 0], y: [0, -20, 0] }}
        transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
        aria-hidden
      />

      {/* app-safe-top: inside the native shell the WebView is already below
          the status bar — env() would double-count it (see globals.css). */}
      <header className="shrink-0 app-safe-top px-4 pt-3 pb-3 relative z-10 flex items-center gap-2">
        <button
          onClick={() => {
            const back = gamesReturnView ?? 'community'
            setGamesReturnView(null)
            setView(back)
          }}
          className="p-2 -ml-1 rounded-full hover:bg-white/5 active:scale-95 transition"
          aria-label="Back"
          data-testid="games-back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Games</h1>
          <p className="text-xs text-white/50 mt-0.5 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-[var(--qk-gold)]" aria-hidden />
            PLAY &amp; CONNECT
          </p>
        </div>
        {/* ❤ lifetime points + 🏆 current realm points (tap → realm
            leaderboard) — the connected pair lives in every Games hub. */}
        <div className="ml-auto">
          <PointsBadges />
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 pb-6 relative z-10">
        {/* Crates banner — one tap into the battle-pass room (crate screen) */}
        <div className="mb-3">
          <CratesBanner />
        </div>

        {/* §89 filter chips */}
        <GamesFilterBar value={gamesFilter} onChange={setGamesFilter} />

        {/* Loading skeleton (§79) */}
        {!loaded && !failed && (
          <div className="grid grid-cols-2 gap-3" data-testid="games-skeleton">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-3xl border border-white/8 bg-white/5 overflow-hidden animate-pulse">
                <div className="aspect-[4/3] bg-white/8" />
                <div className="p-3 flex flex-col gap-2">
                  <div className="h-3 w-2/3 rounded bg-white/10" />
                  <div className="h-2.5 w-1/2 rounded bg-white/8" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error + retry (§79) */}
        {failed && loaded === false && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
            <span className="text-4xl" aria-hidden>🎮</span>
            <p className="text-white/60 text-sm">We couldn&apos;t load the games.</p>
            <button
              onClick={() => void retry()}
              className="text-sm font-bold text-[var(--qk-accent)] px-5 py-2.5 rounded-full border border-[var(--qk-accent)]/30"
              data-testid="games-retry"
            >
              Try again
            </button>
          </div>
        )}

        {/* Grid — exactly 2 per row on mobile (§9) */}
        {loaded && filtered && filtered.length > 0 && (
          <div className="grid grid-cols-2 gap-3" data-testid="games-grid">
            {filtered.map((g, i) => (
              <GameCard key={g.id} game={g} onOpen={open} index={i} testId={`game-card-${g.slug}`} />
            ))}
          </div>
        )}

        {/* Empty state (§70) */}
        {loaded && games && games.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-8">
            <span className="text-4xl" aria-hidden>🎮</span>
            <p className="font-bold">More games are coming soon.</p>
            <p className="text-white/55 text-xs leading-relaxed">
              Check back soon for new ways to play.
            </p>
            <p className="text-white/35 text-[11px] leading-relaxed">
              Local dev tip: run <code className="text-white/60">npm run scripts:seed:games</code> to load the game catalog.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
