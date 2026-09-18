'use client'

// Quicky — LUDO PLAYER HUD (Ludo PRD §29/§30/§42)
//
// Four compact player indicators: profile image, display name, color
// indicator, tokens finished (n/4), online state and current turn state
// ("Your Turn" / "{name}'s Turn"). The active player's chip glows in their
// color; disconnected members dim but keep their seat (§42 — never a ghost
// removal from the HUD, that's the server's call).

import { memo } from 'react'
import type { LudoPlayerSummary } from '@/lib/quicky/ludo-snapshot'

export const LudoPlayerHud = memo(function LudoPlayerHud({
  players,
  currentPlayerId,
  meId,
  onPlayerTap,
}: {
  players: LudoPlayerSummary[]
  currentPlayerId: string | null
  meId: string
  /** §38 REVISED — a tapped chip opens the SHARED player toolbox (the same
   * entry the yard avatars use). Optional; chips stay display-only without. */
  onPlayerTap?: (p: { userId: string; displayName: string; avatar?: string | null }, el: HTMLElement | null) => void
}) {
  // Always show all four seats so the table reads as a Ludo board (empty
  // seats render as placeholders).
  const seats: (LudoPlayerSummary | null)[] = [0, 1, 2, 3].map(
    (seat) => players.find((p) => p.seatIndex === seat) ?? null
  )
  return (
    <div className="ldo-hud" data-testid="ludo-player-hud">
      {seats.map((p, seat) =>
        p ? (
          <div
            key={p.userId}
            className={`ldo-hud-chip${p.userId === currentPlayerId ? ' ldo-active' : ''}${
              p.connection === 'offline' ? ' ldo-offline' : ''
            }${onPlayerTap && p.userId !== meId ? ' ldo-hud-chip-tap' : ''}`}
            style={{ '--chip-color': chipColor(p.color) } as React.CSSProperties}
            data-testid={`ludo-hud-${p.color}`}
            onClick={(e) => {
              if (onPlayerTap && p.userId !== meId) onPlayerTap({ userId: p.userId, displayName: p.displayName, avatar: p.avatar }, e.currentTarget)
            }}
            role={onPlayerTap && p.userId !== meId ? 'button' : undefined}
          >
            <span className="ldo-hud-avatar">
              {p.avatar ? (
                <img src={p.avatar} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span>{(p.displayName || '?').slice(0, 1).toUpperCase()}</span>
              )}
            </span>
            <span className="ldo-hud-meta">
              <span className="ldo-hud-name">{p.displayName ?? 'Player'}</span>
              <span className={`ldo-hud-sub${p.userId === currentPlayerId ? ' ldo-hud-turn' : ''}`}>
                {p.userId === currentPlayerId
                  ? p.userId === meId
                    ? 'Your Turn'
                    : `${p.displayName}'s Turn`
                  : p.connection === 'offline'
                    ? 'Reconnecting…'
                    : `${p.tokensFinished}/4 home`}
              </span>
            </span>
          </div>
        ) : (
          <div key={`empty-${seat}`} className="ldo-hud-chip ldo-offline" aria-hidden>
            <span className="ldo-hud-avatar" style={{ '--chip-color': chipColor(seatColor(seat)) } as React.CSSProperties}>
              <span>+</span>
            </span>
            <span className="ldo-hud-meta">
              <span className="ldo-hud-name" style={{ opacity: 0.5 }}>Open Seat</span>
              <span className="ldo-hud-sub">{seatName(seat)}</span>
            </span>
          </div>
        )
      )}
    </div>
  )
})

import { colorForSeat } from '@/lib/quicky/ludo/constants'
function seatColor(seat: number): string {
  return colorForSeat(seat)
}
function seatName(seat: number): string {
  const c = colorForSeat(seat)
  return c.charAt(0).toUpperCase() + c.slice(1)
}

export function chipColor(color: string): string {
  switch (color) {
    case 'red':
      return 'var(--ldo-red)'
    case 'green':
      return 'var(--ldo-green)'
    case 'yellow':
      return 'var(--ldo-yellow)'
    default:
      return 'var(--ldo-blue)'
  }
}
