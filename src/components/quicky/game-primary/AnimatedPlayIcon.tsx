'use client'

// Quicky — ANIMATED PLAY ICON (Unified Game Primary Screen PRD §54 revised)
//
// The icon INSIDE the [Play Now] button is alive — a tiny idle loop that
// teases the exact physical motion of the game it opens, like a real board
// game inviting you to play:
//
//   bottle → the BOTTLE SPINS (a full twirl with a fast-start, slow-settle
//            easing — the same physics as the in-room bottle), then RESTS,
//            then spins again (Spin the Bottle).
//   dice   → the DICE ROLLS (a tumble + hop, like flicking a die onto the
//            table), then RESTS, then rolls again (Quicky Ludo).
//
// "With a delay": every loop iteration is separated by a deliberate rest
// (repeatDelay) and the FIRST animation waits a beat before starting — the
// button never jitters nervously, it performs, pauses, performs.
//
// Honors prefers-reduced-motion: renders the static glyph instead.
// Game-agnostic: the screen never hardcodes game logic (§4) — the game
// adapters pick the kind via playIcon.

import { motion, useReducedMotion } from 'framer-motion'

const START_DELAY_S = 0.9 // first beat — let the button land, THEN perform
const REST_S = 2.4 // the pause after each spin / roll

export type AnimatedPlayIconKind = 'bottle' | 'dice'

export function AnimatedPlayIcon({ kind }: { kind: AnimatedPlayIconKind }) {
  const reduced = useReducedMotion()

  const glyph = kind === 'bottle' ? '🍾' : '🎲'

  if (reduced) {
    return (
      <span className="inline-block text-[22px] leading-none" aria-hidden>
        {glyph}
      </span>
    )
  }

  if (kind === 'bottle') {
    return (
      <motion.span
        className="inline-block text-[22px] leading-none will-change-transform"
        aria-hidden
        animate={{ rotate: [0, 360] }}
        transition={{
          delay: START_DELAY_S,
          duration: 1.3,
          ease: [0.15, 0.6, 0.3, 1], // fast flick → slow settle, like a real spin
          repeat: Infinity,
          repeatDelay: REST_S,
        }}
      >
        {glyph}
      </motion.span>
    )
  }

  // dice — a roll: the die tumbles a full turn while hopping, lands with a
  // tiny squash, then rests before the next roll.
  return (
    <motion.span
      className="inline-block text-[22px] leading-none will-change-transform"
      aria-hidden
      animate={{
        rotate: [0, 200, 360, 360],
        y: [0, -7, 0, 0],
        scaleY: [1, 1, 0.86, 1],
        scaleX: [1, 1, 1.1, 1],
      }}
      transition={{
        delay: START_DELAY_S,
        duration: 1.1,
        times: [0, 0.55, 0.85, 1],
        ease: 'easeInOut',
        repeat: Infinity,
        repeatDelay: REST_S,
      }}
    >
      {glyph}
    </motion.span>
  )
}
