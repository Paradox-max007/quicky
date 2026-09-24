'use client'

// Quicky — GAMES HUB POINT BADGES (heart + trophy, a connected pair)
//
//   ❤ Heart  — LIFETIME realm points (never resets): 999 → "999",
//              1000 → "1k", 1100 → "1.1k" (formatCompact).
//   🏆 Trophy — CURRENT realm cycle points. Resets to 0 when the realm cycle
//              expires (settlement). Tapping it opens the REALM LEADERBOARD
//              (full screen on mobile web/Capacitor, left drawer on desktop).
//
// Mounted in the Games hub headers (GamesScreen mobile + GamesDesktop web).

import { useEffect } from 'react'
import { Heart, Trophy } from 'lucide-react'
import { useRealmStore } from '@/store/realm'
import { formatCompact } from '@/lib/quicky/format'

export function PointsBadges() {
  const snapshot = useRealmStore((s) => s.snapshot)
  const openLeaderboard = useRealmStore((s) => s.openLeaderboard)

  // The hub badge pair always shows fresh standings (cheap: one status call).
  useEffect(() => {
    if (!useRealmStore.getState().loaded) void useRealmStore.getState().refresh()
  }, [])

  const lifetime = snapshot?.lifetimeRealmPoints ?? null
  const cycle = snapshot?.points ?? null

  return (
    <div className="flex items-center rounded-full border border-white/10 bg-white/5 overflow-hidden" data-testid="games-points-badges">
      <div
        className="flex items-center gap-1.5 pl-3 pr-2.5 py-1.5"
        title="Lifetime Realm Points — everything you have ever earned"
        aria-label={`Lifetime Realm Points: ${lifetime?.toLocaleString() ?? 'loading'}`}
      >
        <Heart className="w-3.5 h-3.5 text-[var(--qk-accent)]" fill="currentColor" aria-hidden />
        <span className="text-[12.5px] font-black tabular-nums">{lifetime != null ? formatCompact(lifetime) : '—'}</span>
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
