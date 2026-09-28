'use client'

// Dating Chat Games — Games Menu Sheet (PRD §5, §6, §51)
//
// Opens from the new 🎮 Games icon in the Dating Chat header. A bottom sheet
// (mobile / tablet) or centered modal (desktop) listing the games in the
// registry. Truth or Dare is HIDDEN — it does not appear (PRD §5).
//
// Behaviour:
//   • Ludo (AVAILABLE) — Play Ludo button → calls onPlayLudo()
//   • Never Have I Ever (COMING_SOON) — visually disabled, attractive; tap
//     shows a small "coming soon" toast (PRD §51). No room / invitation /
//     session is created.
//
// All colors are theme tokens (PRD §50). No hardcoded palettes.

import { motion, AnimatePresence } from 'framer-motion'
import { Gamepad2, X, Clock, Sparkles } from 'lucide-react'
import { visibleDatingGames } from '@/lib/quicky/dating-games/registry'
import { toast } from 'sonner'

export function GamesMenuSheet({
  open,
  onClose,
  onPlayLudo,
}: {
  open: boolean
  onClose: () => void
  onPlayLudo: () => void
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — tap to close (the menu itself is dismissible; only
              the in-app invitation popup is mandatory / non-dismissible per
              PRD §12). */}
          <motion.div
            className="fixed inset-0 bg-black/60 z-[180]"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Bottom sheet — mobile-first; on desktop the same sheet sits
              centered via max-w + mx-auto. PRD §48 responsive. */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed left-0 right-0 bottom-0 z-[190]
                       mx-auto max-w-md
                       bg-[var(--qk-card)] border-t border-white/10
                       rounded-t-3xl p-4 pb-6"
          >
            {/* Drag handle */}
            <div className="mx-auto mb-3 w-10 h-1 rounded-full bg-white/15" />

            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-2xl bg-[var(--qk-accent)]/15 border border-[var(--qk-accent)]/30 flex items-center justify-center">
                  <Gamepad2 className="w-5 h-5 text-[var(--qk-accent)]" />
                </div>
                <div>
                  <h2 className="font-bold text-base text-[var(--qk-text)]">Games</h2>
                  <p className="text-[11px] text-[var(--qk-text)]/50">Play with your chat partner</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-white/5 text-[var(--qk-text)]/60"
                aria-label="Close games menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Game cards */}
            <div className="flex flex-col gap-3">
              {visibleDatingGames.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  onPlay={() => {
                    if (game.id === 'ludo') {
                      onClose()
                      onPlayLudo()
                    } else if (game.status === 'COMING_SOON') {
                      // PRD §51 — informational toast, no room / invitation.
                      toast(`${game.name} is coming soon.`, {
                        icon: '✨',
                        duration: 2500,
                      })
                    }
                  }}
                />
              ))}
            </div>

            {/* Footer hint */}
            <p className="text-[10px] text-[var(--qk-text)]/40 mt-4 text-center">
              More games are on the way.
            </p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function GameCard({
  game,
  onPlay,
}: {
  game: { id: string; name: string; description: string; status: string; emoji: string }
  onPlay: () => void
}) {
  const comingSoon = game.status === 'COMING_SOON'
  return (
    <button
      onClick={onPlay}
      disabled={comingSoon}
      className={`
        relative w-full text-left rounded-2xl overflow-hidden
        border transition-all
        ${comingSoon
          ? 'border-white/10 bg-white/[0.03] cursor-default'
          : 'border-[var(--qk-accent)]/30 bg-gradient-to-br from-[var(--qk-accent)]/8 to-[var(--qk-purple)]/8 hover:border-[var(--qk-accent)]/50 active:scale-[0.99]'
        }
        p-4
      `}
    >
      <div className="flex items-start gap-3">
        <div
          className={`
            shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center text-2xl
            ${comingSoon ? 'bg-white/5' : 'bg-[var(--qk-accent)]/15 border border-[var(--qk-accent)]/25'}
          `}
        >
          {game.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className={`font-bold text-sm ${comingSoon ? 'text-[var(--qk-text)]/70' : 'text-[var(--qk-text)]'}`}>
              {game.name.toUpperCase()}
            </h3>
            {comingSoon && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                              bg-white/10 text-[9px] font-bold uppercase tracking-widest
                              text-[var(--qk-text)]/55">
                <Clock className="w-2.5 h-2.5" />
                Coming Soon
              </span>
            )}
          </div>
          <p className={`text-[12px] mt-0.5 ${comingSoon ? 'text-[var(--qk-text)]/45' : 'text-[var(--qk-text)]/65'}`}>
            {game.description}
          </p>
          {!comingSoon && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full
                            bg-[var(--qk-accent)] text-[var(--qk-on-accent)]
                            text-xs font-bold uppercase tracking-wider
                            shadow-[0_4px_14px_-4px_var(--qk-accent)]">
              <Sparkles className="w-3 h-3" />
              Play {game.name}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}
