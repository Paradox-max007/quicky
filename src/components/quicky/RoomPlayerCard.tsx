'use client'

import { motion } from 'framer-motion'

// RoomPlayerCard — rounded-square photo card used for the 12 stage seats,
// styled after the approved mockups: colored gradient frame + soft glow,
// level badge (or VIP badge for premium), SPINNER / TARGET role tags on web,
// and a name pill below (plain text with drop shadow on mobile via CSS).
// Sized entirely by the --seat-w CSS variable so proportions stay identical
// from small phones to desktop.
//
// The wrapper is a framer-motion div: when the bottle stops, the parent flips
// the `spotlight` prop and the spinner/target cards SLIDE from their seat to
// the duel center (spring on left/top) and pop slightly bigger while there;
// when the duel ends they spring back. Cards that never move don't animate.

export type SeatPlayer = {
  userId: string
  seatIndex: number
  displayName: string
  avatar: string | null
  isMe?: boolean
  isPremium?: boolean
  isCurrentTurn?: boolean
  isTarget?: boolean
  /** Render order — only used to stagger the seat-pop entry animation. */
  joinedAt?: number
}

/* Frame system — future shop frames only need a new entry here.
   Each frame = gradient (frame ring) + matching glow color. */
export type PlayerFrame = {
  id: string
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  from: string
  to: string
  accent: string
  frameClass?: string
  decoration?: 'crown' | 'sparkle' | null
}

const FRAMES: PlayerFrame[] = [
  { id: 'violet', rarity: 'rare', from: '#a855f7', to: '#6366f1', accent: '#a855f7' },
  { id: 'cyan', rarity: 'rare', from: '#22d3ee', to: '#2563eb', accent: '#22d3ee' },
  { id: 'amber', rarity: 'common', from: '#fbbf24', to: '#f97316', accent: '#fbbf24' },
  { id: 'emerald', rarity: 'common', from: '#34d399', to: '#0d9488', accent: '#34d399' },
  { id: 'indigo', rarity: 'epic', from: '#818cf8', to: '#ec4899', accent: '#818cf8' },
  { id: 'slate', rarity: 'common', from: '#e2e8f0', to: '#94a3b8', accent: '#cbd5e1' },
]

const SPINNER_FRAME: PlayerFrame = {
  id: 'spinner', rarity: 'epic', from: '#38bdf8', to: '#0ea5e9', accent: '#38bdf8',
  frameClass: 'sbr-turn',
}
const TARGET_FRAME: PlayerFrame = {
  id: 'target', rarity: 'epic', from: '#fb7185', to: '#e11d48', accent: '#fb7185',
  frameClass: 'sbr-target', decoration: 'sparkle',
}
const VIP_FRAME: PlayerFrame = {
  id: 'gold', rarity: 'legendary', from: '#fde68a', to: '#f59e0b', accent: '#fbbf24',
  frameClass: 'sbr-premium',
}

/** Deterministic pseudo-level per player — decorative, stable per user. */
function levelFor(userId: string): number {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return 3 + (h % 34)
}

export function frameForPlayer(p: SeatPlayer): PlayerFrame {
  // Role frames win over everything (matches the mockups: SPINNER cyan,
  // TARGET rose, premium gold otherwise).
  if (p.isCurrentTurn) return SPINNER_FRAME
  if (p.isTarget) return TARGET_FRAME
  if (p.isPremium) return VIP_FRAME
  let h = 0
  for (let i = 0; i < p.userId.length; i++) h = (h * 33 + p.userId.charCodeAt(i)) >>> 0
  return FRAMES[h % FRAMES.length]
}

export function RoomPlayerCard({
  player,
  x,
  y,
  joinedAt = 0,
  spotlight = false,
}: {
  player: SeatPlayer
  /** Seat center as percentages of the stage box. */
  x: number
  y: number
  joinedAt?: number
  /** True while this card is in the duel spotlight (center stage). */
  spotlight?: boolean
}) {
  const frame = frameForPlayer(player)
  const initial = (player.displayName ?? '?').trim().slice(0, 1).toUpperCase()
  const name = player.isMe ? `${player.displayName} (you)` : player.displayName
  const roleTag = player.isCurrentTurn ? 'Spinner' : player.isTarget ? 'Target' : null

  // Frame ring gradient + soft glow. Role frames (turn/target/premium) carry
  // their stronger glow in CSS; plain frames get a gentle inline glow.
  const frameVars = {
    ['--seat-ring' as string]: `linear-gradient(140deg, ${frame.from}, ${frame.to})`,
    ...(frame.frameClass
      ? {}
      : { boxShadow: `0 0 12px 2px ${frame.accent}4d, 0 3px 10px rgba(20,8,2,0.55)` }),
  }

  return (
    <motion.div
      className={`sbr-seat ${spotlight ? 'sbr-seat-dueling' : ''}`}
      initial={false}
      animate={{
        left: `${x}%`,
        top: `${y}%`,
        // framer owns the transform while animating, so the CSS centering
        // translate is folded in here (scale pops the card in the spotlight)
        x: '-50%',
        y: '-50%',
        scale: spotlight ? 1.16 : 1,
      }}
      transition={{
        left: { type: 'spring', stiffness: 190, damping: 24 },
        top: { type: 'spring', stiffness: 190, damping: 24 },
        scale: { type: 'spring', stiffness: 320, damping: 20 },
        default: { duration: 0.2 },
      }}
      style={{
        animationDelay: `${joinedAt * 45}ms`,
        // §87: will-change ONLY on the actively animating (spotlight) cards
        willChange: spotlight ? 'left, top, transform' : undefined,
      }}
    >
      <div className={`sbr-seat-frame ${frame.frameClass ?? ''}`} style={frameVars}>
        <span
          className="sbr-seat-initial"
          style={{ background: `linear-gradient(150deg, ${frame.from}, ${frame.to})` }}
        >
          {initial}
        </span>
        {player.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="sbr-seat-img" src={player.avatar} alt={name} draggable={false} loading="eager" />
        ) : null}
        {player.isPremium ? (
          <span className="sbr-seat-level sbr-seat-vip" title="VIP">VIP</span>
        ) : (
          <span className="sbr-seat-level" title="Level">{levelFor(player.userId)}</span>
        )}
        {roleTag && <span className={`sbr-seat-roletag sbr-roletag-${roleTag.toLowerCase()}`}>{roleTag}</span>}
        {player.isTarget && <span className="sbr-target-spark" aria-hidden>✨</span>}
      </div>
      <span className="sbr-seat-name">{name}{player.isCurrentTurn ? ' ★' : ''}</span>
    </motion.div>
  )
}
