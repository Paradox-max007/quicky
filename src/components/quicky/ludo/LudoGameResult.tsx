'use client'

// Quicky — LUDO GAME RESULT (Ludo PRD §28/§74/§103/§104)
//
// Winner celebration: all four tokens glow on the board (handled by the
// game area), the winner's avatar appears with "WINS!" and a tasteful
// confetti burst (disabled under prefers-reduced-motion, §104). Two exits:
// leave the table (→ Ludo landing) — the room lifecycle keeps cleaning up
// behind them (§41).

import { memo, useMemo } from 'react'
import { LogOut, RefreshCw } from 'lucide-react'

export const LudoGameResult = memo(function LudoGameResult({
  winnerName,
  winnerAvatar,
  players,
  onLeave,
}: {
  winnerName: string
  winnerAvatar: string | null
  players: { userId: string; displayName: string; color: string; tokensFinished: number; captures: number }[]
  onLeave: () => void
}) {
  const confetti = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        left: `${(i * 3.85 + (i % 5) * 1.7) % 100}%`,
        delay: `${(i % 9) * 0.22}s`,
        duration: `${2 + (i % 5) * 0.35}s`,
        color: ['#f43f5e', '#10b981', '#f59e0b', '#38bdf8'][i % 4],
      })),
    []
  )
  const standings = [...players].sort((a, b) => b.tokensFinished - a.tokensFinished || b.captures - a.captures)

  return (
    <div className="ldo-result" data-testid="ludo-result">
      <div className="ldo-confetti" aria-hidden>
        {confetti.map((c, i) => (
          <i
            key={i}
            style={{
              left: c.left,
              background: c.color,
              animationDelay: c.delay,
              animationDuration: c.duration,
            }}
          />
        ))}
      </div>
      <div className="ldo-result-avatar">
        {winnerAvatar ? (
          <img src={winnerAvatar} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontWeight: 900, fontSize: 34, color: '#fff' }}>
            {(winnerName || '?').slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
      <p className="ldo-result-title">{winnerName} WINS!</p>
      <p className="ldo-result-sub">
        {standings
          .slice(0, 4)
          .map((p) => `${p.displayName} · ${p.tokensFinished}/4 home`)
          .join('  ·  ')}
      </p>
      <button
        className="ldo-roll-btn"
        onClick={onLeave}
        data-testid="ludo-result-leave"
        style={{ marginTop: 8 }}
      >
        <LogOut className="h-4 w-4" /> Back to Ludo
      </button>
      <span className="ldo-hud-sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <RefreshCw className="h-3 w-3" aria-hidden /> Rejoin any time from the Games hub
      </span>
    </div>
  )
})
