'use client'

// Quicky — GAMES HUB POINT BADGES (heart + trophy, a connected pair)
//
//   ❤ Heart  — MONTHLY SEASON points (crate-pass PRD): everything earned
//              during the active calendar-month season; resets when the
//              season rolls over. 999 → "999", 1000 → "1k" (formatCompact).
//   🏆 Trophy — CURRENT realm cycle points. Resets to 0 when the realm cycle
//              expires (settlement). Tapping it opens the REALM LEADERBOARD
//              (full screen on mobile web/Capacitor, left drawer on desktop).
//
// Mounted in the Games hub headers (GamesScreen mobile + GamesDesktop web).
// Same semantics as the room HUD chips (❤ season · 🏆 realm).

import { useEffect } from 'react'
import { Heart, Trophy } from 'lucide-react'
import { useRealmStore } from '@/store/realm'
import { usePassStore } from '@/store/pass'
import { formatCompact } from '@/lib/quicky/format'

export function PointsBadges() {
  const snapshot = useRealmStore((s) => s.snapshot)
  const openLeaderboard = useRealmStore((s) => s.openLeaderboard)
  const season = usePassStore((s) => s.season)
  const refreshSeason = usePassStore((s) => s.refreshSeason)

  // The hub badge pair always shows fresh standings (cheap: one status call
  // for the realm + one for the monthly season).
  useEffect(() => {
    if (!useRealmStore.getState().loaded) void useRealmStore.getState().refresh()
    if (!usePassStore.getState().seasonLoaded) void refreshSeason()
  }, [refreshSeason])

  const seasonPoints = season?.points ?? null
  const cycle = snapshot?.points ?? null

  return (
    <div className="flex items-center rounded-full border border-white/10 bg-white/5 overflow-hidden" data-testid="games-points-badges">
      <div
        className="flex items-center gap-1.5 pl-3 pr-2.5 py-1.5"
        title="Season points — resets when the monthly season rolls over"
        aria-label={`Season points: ${seasonPoints?.toLocaleString() ?? 'loading'}`}
      >
        <Heart className="w-3.5 h-3.5 text-[var(--qk-accent)]" fill="currentColor" aria-hidden />
        <span className="text-[12.5px] font-black tabular-nums">{seasonPoints != null ? formatCompact(seasonPoints) : '—'}</span>
      </div>
      <div className="w-px h-5 bg-white/10" aria-hidden />
      <button
        onClick={openLeaderboard}
        className="flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 hover:bg-white/8 active:scale-[0.97] transition-all"
        title="Current realm points — resets when the cycle ends. Tap for the realm leaderboard."
        aria-label={`Current realm points: ${cycle?.toLocaleString() ?? 'loading'} — open realm leaderboard`}
        data-testid="games-trophy-button"
      >
        <Trophy className="w-3.5 h-3.5 text-[var(--qk-gold)]" aria-hidden />
        <span className="text-[12.5px] font-black tabular-nums" style={{ color: 'var(--qk-gold)' }}>
          {cycle != null ? formatCompact(cycle) : '—'}
        </span>
      </button>
    </div>
  )
}
