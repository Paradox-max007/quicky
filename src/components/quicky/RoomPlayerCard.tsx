'use client'

// RoomPlayerCard — square framed photo card used for the 12 stage seats.
// Frame states are data-driven: default / premium / current-turn / target.
// Sized entirely by the --seat-w CSS variable so proportions stay identical
// from small phones to desktop.

export type SeatPlayer = {
  userId: string
  seatIndex: number
  displayName: string
  avatar: string | null
  isMe?: boolean
  isPremium?: boolean
  isCurrentTurn?: boolean
  isTarget?: boolean
}

/* Frame system — future shop frames only need a new entry here. */
export type PlayerFrame = {
  id: string
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  accent: string
  frameClass?: string
  decoration?: 'crown' | 'sparkle'
}

const FRAME_BY_RARITY: Record<PlayerFrame['rarity'], PlayerFrame> = {
  common: { id: 'default', rarity: 'common', accent: '#ff8fb3' },
  rare: { id: 'blue', rarity: 'rare', accent: '#5ac8fa' },
  epic: { id: 'purple', rarity: 'epic', accent: '#b85cff' },
  legendary: { id: 'gold', rarity: 'legendary', accent: '#f5c04a', frameClass: 'sbr-premium', decoration: 'crown' },
}

/** Deterministic pseudo-level per player — decorative, stable per user. */
function levelFor(userId: string): number {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return 3 + (h % 34)
}

export function frameForPlayer(p: SeatPlayer): PlayerFrame {
  if (p.isPremium) return FRAME_BY_RARITY.legendary
  if (p.isTarget) return { ...FRAME_BY_RARITY.common, accent: '#ff4f91', decoration: 'sparkle' }
  let h = 0
  for (let i = 0; i < p.userId.length; i++) h = (h * 33 + p.userId.charCodeAt(i)) >>> 0
  const rarities: PlayerFrame['rarity'][] = ['common', 'common', 'rare', 'common', 'epic', 'rare']
  const rarity = rarities[h % rarities.length]
  return FRAME_BY_RARITY[rarity]
}

export function RoomPlayerCard({
  player,
  x,
  y,
  joinedAt = 0,
}: {
  player: SeatPlayer
  /** Seat center as percentages of the stage box. */
  x: number
  y: number
  joinedAt?: number
}) {
  const frame = frameForPlayer(player)
  const initial = (player.displayName ?? '?').trim().slice(0, 1).toUpperCase()
  const name = player.isMe ? `${player.displayName} (you)` : player.displayName

  const stateClass = player.isTarget ? 'sbr-target' : player.isCurrentTurn ? 'sbr-turn' : frame.frameClass ?? ''

  return (
    <div
      className="sbr-seat"
      style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${joinedAt * 45}ms` }}
    >
      <div className={`sbr-seat-frame ${stateClass}`} style={{ ['--seat-accent' as string]: frame.accent }}>
        <span className="sbr-seat-initial" style={{ background: `linear-gradient(150deg, ${frame.accent}, #8a5a30)` }}>
          {initial}
        </span>
        {player.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="sbr-seat-img" src={player.avatar} alt={name} draggable={false} loading="eager" />
        ) : null}
        <span className="sbr-seat-level" title="Level">{levelFor(player.userId)}</span>
        {player.isPremium && <span className="sbr-premium-crown" aria-hidden>👑</span>}
        {player.isTarget && <span className="sbr-target-spark" aria-hidden>✨</span>}
      </div>
      <span className="sbr-seat-name">{name}</span>
    </div>
  )
}
