'use client'

// Quicky — GAME CARD (Games PRD §36-§42 + Game Hub PRD §9/§10/§69/§88 +
// Premium Party Games PRD §7 — premium lock UI for free users)
//
// ALL games are EQUAL cards (§36 — no giant banner): dark surface, subtle
// border, rounded corners, large artwork, compact metadata. The whole card
// is tappable (44px+) and opens the game's landing page.
//
// §38/§39 — active players: "● 128 playing" with a green pulsing dot, driven
// by the near-realtime count feed (respects prefers-reduced-motion, §40).
// §41/§42 — inactive games show a polished COMING SOON treatment: faded
// artwork, subtle dark overlay, animated label, disabled Play — never a
// broken-looking gray card.
//
// Premium Party Games PRD §7 — for premium games (Spin the Bottle + Ludo),
// a free user sees a "🔒 Premium" badge over the artwork + the CTA swaps
// from "Play" to "Unlock". Tapping the card opens the paywall directly
// (one fewer screen — PRD §43: "Show the Premium modal directly"). Premium
// users see the same card as if it were free.
import { motion } from 'framer-motion'
import { Play, Users, Lock } from 'lucide-react'
import { artworkGradient, modeLabel, type GameDef } from './types'
import { useQuickyStore } from '@/store/quicky'
// Premium Party Games PRD §7 — uses the canonical `slugToGameId()` helper
// from entitlements.ts so the GameDefinition catalog slug (e.g.
// 'spin-the-bottle') is mapped to the canonical entitlement id (e.g.
// 'spin_bottle') via the GAME_SLUG_ALIASES map. The previous inline
// `slug.replace(/-/g, '_')` produced 'spin_the_bottle' which was NOT in
// the entitlement table → `isPremiumPartyGame()` returned false → no
// lock badge was rendered (the bug).
import {
  canPlayGameClient,
  isPremiumPartyGame,
  slugToGameId,
} from '@/lib/quicky/entitlements'

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
  const playable = game.isPlayable
  const user = useQuickyStore((s) => s.user)
  // Compute the premium lock state client-side from the entitlement table.
  // The server is the authority (join routes return 402); this is purely a
  // visual hint so the user knows BEFORE tapping that the game is premium.
  const gameId = slugToGameId(game.slug)
  const isPremiumGame = isPremiumPartyGame(gameId)
  const entitlement = canPlayGameClient(user, gameId)
  const lockedForFree = isPremiumGame && !entitlement.allowed

  const handleOpen = () => {
    // PRD §43 — for a locked premium game, open the paywall directly
    // instead of routing to the landing page (which would just spin the
    // matchmaking modal and then fail with a 402).
    if (lockedForFree) {
      useQuickyStore.getState().showPaywall({ kind: 'games' })
      return
    }
    onOpen(game.slug)
  }

  return (
    <motion.button
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.05, 0.3) }}
      whileTap={{ scale: 0.97 }}
      whileHover={playable ? { y: -2 } : undefined}
      onClick={handleOpen}
      className="group relative text-left rounded-3xl overflow-hidden border border-white/10 bg-[var(--qk-card)]/70 hover:border-white/20 hover:shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition-all min-h-[44px]"
      data-testid={testId}
      aria-label={
        lockedForFree
          ? `${game.name} — Premium`
          : playable
            ? `Play ${game.name}`
            : `${game.name} — coming soon`
      }
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
          className={`relative text-5xl drop-shadow-lg ${playable && !lockedForFree ? '' : 'opacity-60 saturate-50'}`}
          whileHover={playable && !lockedForFree ? { scale: 1.03, rotate: -2 } : undefined}
          transition={{ duration: 0.2 }}
          aria-hidden
        >
          {game.icon}
        </motion.span>

        {/* §38/§39 — LIVE player count (green pulsing dot + people icon) */}
        {playable && !lockedForFree && game.activePlayers > 0 && (
          <span
            className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/50 backdrop-blur px-2 py-0.5 text-[9px] font-black tracking-wide text-white"
            data-testid={`${testId ?? 'game-card'}-players`}
          >
            {/* §40: subtle 1.5-2s opacity/scale pulse, disabled for
                prefers-reduced-motion users (motion-safe variant) */}
            <span className="relative flex w-1.5 h-1.5" aria-hidden>
              <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-[#30D158] opacity-60" />
              <span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-[#30D158]" />
            </span>
            <Users className="w-2.5 h-2.5" aria-hidden />
            {game.activePlayers} playing
          </span>
        )}

        {/* Premium Party Games PRD §7 — 🔒 Premium lock badge.
            Shown over the artwork for premium games when the user is free.
            Mirrors the existing SOON badge style so the visual treatment
            is consistent across the "not available" states. */}
        {lockedForFree && (
          <>
            <div className="absolute inset-0 bg-black/45" aria-hidden />
            <span
              className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[10px] font-black tracking-[0.3em] text-white/90 uppercase"
              data-testid={`${testId ?? 'game-card'}-premium`}
            >
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--qk-gold)]/15 border border-[var(--qk-gold)]/40">
                <Lock className="w-3 h-3 text-[var(--qk-gold)]" aria-hidden />
                Premium
              </span>
            </span>
            <span className="absolute top-2.5 left-2.5 rounded-full bg-[var(--qk-gold)]/20 backdrop-blur px-2 py-0.5 text-[9px] font-black tracking-wider text-[var(--qk-gold)]">
              PRO
            </span>
          </>
        )}

        {/* §41/§42 — polished Coming Soon treatment (never a broken gray card) */}
        {!playable && !lockedForFree && (
          <>
            <div className="absolute inset-0 bg-black/45" aria-hidden />
            <span
              className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[10px] font-black tracking-[0.3em] text-white/90 uppercase"
              data-testid={`${testId ?? 'game-card'}-soon`}
            >
              <span className="motion-safe:animate-pulse">✨ Coming Soon ✨</span>
            </span>
            <span className="absolute top-2.5 left-2.5 rounded-full bg-black/45 backdrop-blur px-2 py-0.5 text-[9px] font-black tracking-wider text-white/70">
              SOON
            </span>
          </>
        )}
      </div>

      {/* Metadata (§10: name / mode / CTA) */}
      <div className="p-3 flex flex-col gap-1.5">
        <p className="text-sm font-bold text-white truncate">{game.name}</p>
        <p className="text-[10px] font-semibold text-white/55">{modeLabel(game)}</p>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[10px] text-white/40 truncate">{game.shortDescription}</span>
          <span
            className={`shrink-0 ml-2 flex items-center gap-1 text-[11px] font-black ${
              lockedForFree
                ? 'text-[var(--qk-gold)]'
                : playable
                  ? 'text-[var(--qk-accent)]'
                  : 'text-white/40'
            }`}
          >
            {lockedForFree ? (
              <>
                Unlock
                <Lock className="w-3 h-3" fill="currentColor" aria-hidden />
              </>
            ) : playable ? (
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
