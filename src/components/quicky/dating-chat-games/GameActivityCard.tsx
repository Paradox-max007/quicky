'use client'

// Dating Chat Games — Game Activity Card (PRD §31-§37, §56, §57)
//
// Renders a "shared memory" card in the dating chat when a 1-on-1 game
// completes. The card is:
//   - Server-authored (type='game_activity', metadata carries the payload)
//   - Single per conversation (NOT per user — PRD §57)
//   - Theme-aware (uses --qk-* tokens — PRD §50)
//   - Softly animated on FIRST insert only (PRD §36, §37 — fade-in + slight
//     upward movement + 96% → 100% scale; not re-animated on scroll-back)
//   - Responsive (mobile + tablet + desktop — PRD §48)

import { motion } from 'framer-motion'
import { Gamepad2, Clock, Sparkles } from 'lucide-react'
import type { GameActivityPayload } from '@/lib/quicky/dating-games/game-activity'
import { formatGameDuration } from '@/lib/quicky/dating-games/game-activity'

// Track which activity cards we've already animated so re-renders /
// scroll-back don't replay the entrance (PRD §37).
const animatedIds = new Set<string>()

export function GameActivityCard({
  messageId,
  metadata,
  meId,
}: {
  messageId: string
  metadata: string | null
  meId: string
}) {
  if (!metadata) return null
  let payload: GameActivityPayload | null = null
  try {
    payload = JSON.parse(metadata) as GameActivityPayload
  } catch {
    return null
  }
  if (!payload) return null

  const durationLabel = formatGameDuration(payload.durationSeconds)
  const shouldAnimate = !animatedIds.has(messageId)
  if (shouldAnimate) animatedIds.add(messageId)
  // `meId` + `payload.playerAId/playerBId/winnerId` available for future
  // "you won / they won" or player-avatar rendering. Currently the card
  // is rendered identically for both sides per PRD §33/§57.
  void meId

  return (
    <div className="w-full flex justify-center my-3 px-2">
      <motion.div
        initial={shouldAnimate ? { opacity: 0, y: 14, scale: 0.96 } : false}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-[min(92%,28rem)] rounded-3xl overflow-hidden
                   bg-gradient-to-br from-[var(--qk-card)] to-[var(--qk-elev)]
                   border border-[var(--qk-accent)]/25
                   shadow-[0_8px_32px_-12px_rgba(0,0,0,0.5)]
                   hover:shadow-[0_10px_36px_-10px_var(--qk-accent)]/30
                   transition-shadow"
      >
        {/* Top accent bar */}
        <div className="h-1 w-full bg-gradient-to-r from-[var(--qk-accent)] via-[var(--qk-purple)] to-[var(--qk-accent-light)] opacity-70" />

        {/* Subtle radial glow background */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{
            background:
              'radial-gradient(circle at 30% 0%, var(--qk-accent) 0%, transparent 55%)',
          }}
        />

        <div className="relative px-5 pt-4 pb-4 flex flex-col items-center gap-2 text-center">
          {/* Game icon + name */}
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-2xl bg-[var(--qk-accent)]/15 border border-[var(--qk-accent)]/30 flex items-center justify-center">
              <Gamepad2 className="w-5 h-5 text-[var(--qk-accent)]" />
            </div>
            <h3 className="font-bold text-base tracking-wide text-[var(--qk-text)]">
              {payload.gameName}
            </h3>
          </div>

          {/* "GAME COMPLETED" pill */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full
                          bg-[var(--qk-accent)]/10 border border-[var(--qk-accent)]/25
                          text-[10px] font-semibold uppercase tracking-widest
                          text-[var(--qk-accent-light)]">
            <Sparkles className="w-3 h-3" />
            Game Completed
          </div>

          {/* Main line */}
          <p className="text-sm font-semibold text-[var(--qk-text)]">
            You played {payload.gameName}
          </p>

          {/* Duration */}
          <div className="flex items-center gap-1.5 mt-0.5">
            <Clock className="w-3.5 h-3.5 text-[var(--qk-accent-light)]" />
            <span className="text-xl font-bold tracking-tight text-[var(--qk-text)]">
              {durationLabel}
            </span>
          </div>

          {/* Divider + footer */}
          <div className="w-full h-px my-1 bg-[var(--qk-accent)]/15" />
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--qk-text)]/45 font-medium">
            Shared game memory
          </p>
        </div>
      </motion.div>
    </div>
  )
}
