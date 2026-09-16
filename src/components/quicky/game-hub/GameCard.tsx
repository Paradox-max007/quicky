'use client'

// Quicky — GAME CARD (Game Hub PRD §9/§10/§69/§88)
// Dark surface, subtle border, rounded corners, large artwork, compact
// metadata, clean typography (§88). The WHOLE card is tappable (§69,
// 44px+ target) and opens the game's landing page.

import { motion } from 'framer-motion'
import { Play } from 'lucide-react'
import { artworkGradient, modeLabel, type GameDef } from './types'

export function GameCard({
  game,
  onOpen,
  index = 0,
  testId,
}: {
  game: GameDef
  onOpen: (slug: string) => void
  index?: number
  testId?: string
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.05, 0.3) }}
      whileTap={{ scale: 0.97 }}
      onClick={() => onOpen(game.slug)}
      className="group relative text-left rounded-3xl overflow-hidden border border-white/10 bg-[var(--qk-card)]/70 hover:border-white/20 transition-colors min-h-[44px]"
      data-testid={testId}
      aria-label={`Open ${game.name}`}
    >
      {/* Artwork area (§10: large visual) */}
      <div
        className={`relative aspect-[4/3] ${artworkGradient(game.artwork)} flex items-center justify-center overflow-hidden`}
      >
        <div
          className="absolute inset-0 bg-[radial-gradient(circle_at_30%_22%,rgba(255,255,255,0.28),transparent_55%)]"
          aria-hidden
        />
        <motion.span
          className="relative text-5xl drop-shadow-lg"
          whileHover={{ scale: 1.08, rotate: -3 }}
          transition={{ duration: 0.2 }}
          aria-hidden
        >
          {game.icon}
        </motion.span>
        {/* Status badge (§10: optional ● Live) — honest, DB-driven */}
        {game.isPlayable ? (
          <span className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/45 backdrop-blur px-2 py-0.5 text-[9px] font-black tracking-wider text-white">
            <span className="w-1.5 h-1.5 rounded-full bg-[#30D158]" aria-hidden />
            LIVE
          </span>
        ) : (
          <span className="absolute top-2.5 left-2.5 rounded-full bg-black/45 backdrop-blur px-2 py-0.5 text-[9px] font-black tracking-wider text-white/70">
            SOON
          </span>
        )}
      </div>

      {/* Metadata (§10: name / mode / CTA) */}
      <div className="p-3 flex flex-col gap-1.5">
        <p className="text-sm font-bold text-white truncate">{game.name}</p>
        <p className="text-[10px] font-semibold text-white/55">{modeLabel(game)}</p>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[10px] text-white/40 truncate">{game.shortDescription}</span>
          <span className="shrink-0 ml-2 flex items-center gap-1 text-[11px] font-black text-[var(--qk-accent)]">
            {game.isPlayable ? (
              <>
                Play
                <Play className="w-3 h-3" fill="currentColor" aria-hidden />
              </>
            ) : (
              'Info'
            )}
          </span>
        </div>
      </div>
    </motion.button>
  )
}
