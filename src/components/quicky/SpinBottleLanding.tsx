'use client'

// Quicky — Spin the Bottle landing (Unified Game Primary Screen PRD §1/§55/§57)
//
// This is now a thin GAME ADAPTER around the reusable GamePrimaryScreen:
// it fetches the Spin the Bottle data (landing stats, admin rules, catalog
// entry), builds the GamePrimaryConfig and wires the REAL matchmaking flow
// (v3 PRD §7/§8 matchmaking modal → join API → room). The screen itself —
// hero, profile/stat card with 💬/👥 icons, combined stats, rotating texts,
// progress, how-it-works — is rendered by GamePrimaryScreen for EVERY game.
// The matchmaking MODAL is the SHARED MatchmakingModal (one join flow for
// every game — only the status copy differs).
//
// The old bottom Game Chats section is REMOVED (Unified PRD §11): chat lives
// behind the 💬 icon (GameInteractionPanel on web / dedicated contacts screen
// on Capacitor), friends behind the 👥 icon.
//
// Back (§4-§6 v3): the header arrow calls onClose → explicit setView — never
// a visual-only element, never a duplicate-history router.back().

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { CoinStoreSheet } from './CoinStoreSheet'
import { AnimatedPlayIcon } from './game-primary/AnimatedPlayIcon'
import { GamePrimaryScreen } from './game-primary/GamePrimaryScreen'
import { MatchmakingModal } from './game-primary/MatchmakingModal'
import {
  buildSpinPrimaryConfig,
  type GameDef,
  type GameHowItWorksStep,
  type LudoLandingStats,
  type SpinLandingStats,
} from './game-primary/game-configs'

export function SpinBottleLanding({
  onClose,
  onJoined,
  backLabel = 'Back to Community',
}: {
  onClose: () => void
  onJoined: (roomId: string) => void
  /** Game Hub PRD §12: when opened from the Games hub the back goes to Games. */
  backLabel?: string
}) {
  const user = useQuickyStore((s) => s.user)
  const [game, setGame] = useState<GameDef | null>(null)
  const [stats, setStats] = useState<SpinLandingStats | null>(null)
  const [rules, setRules] = useState<GameHowItWorksStep[] | null>(null)
  const [ludoStats, setLudoStats] = useState<LudoLandingStats | null>(null)
  const [failed, setFailed] = useState(false)
  // Refactor PRD §24 — the landing coin chip opens the same CoinStoreSheet
  // used inside the room; purchases reconcile the landing balance.
  const [coinStoreOpen, setCoinStoreOpen] = useState(false)
  const [coinBalance, setCoinBalance] = useState(0)
  const [finding, setFinding] = useState(false)
  const cancelledRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setFailed(false)
      try {
        // Landing stats + catalog entry + admin how-it-works rules — the
        // ludo payload is ONLY fetched to compute the §7 combined totals.
        const [s, cat, r, ludo] = await Promise.all([
          api.spinBottle.landing(),
          api.games.list(),
          api.spinBottle.rules().catch(() => null),
          api.ludo.landing().catch(() => null),
        ])
        if (cancelled) return
        setStats(s)
        setCoinBalance(s?.coins ?? 0)
        setGame(cat.games?.find((g: GameDef) => g.slug === 'spin-the-bottle') ?? null)
        setRules((r?.rules ?? null) as GameHowItWorksStep[] | null)
        if (ludo) setLudoStats(ludo)
      } catch (e: any) {
        if (!cancelled) {
          setFailed(true)
          toast.error(e?.message ?? 'Failed to load stats')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const play = () => {
    if (finding) return
    setFinding(true)
    cancelledRef.current = false
    // Fire-and-forget — the matchmaking screen shows INSTANTLY (§7), the
    // request runs underneath it.
    void (async () => {
      try {
        const res = await api.spinBottle.join()
        if (cancelledRef.current) {
          // User cancelled while the request was in flight — quietly leave
          // the room we just joined so no ghost membership remains.
          if (res?.roomId) void api.spinBottle.leave(res.roomId).catch(() => {})
          return
        }
        if (res?.roomId) onJoined(res.roomId)
      } catch (e: any) {
        if (cancelledRef.current) return
        toast.error(e.message ?? 'Failed to join a room')
        setFinding(false)
      }
    })()
  }

  const cancelMatchmaking = () => {
    cancelledRef.current = true
    setFinding(false)
  }

  const avatar = user?.photos?.find((p: any) => p.isPrimary)?.url ?? user?.photos?.[0]?.url
  const level = stats?.level ?? 1
  const config = buildSpinPrimaryConfig(game, stats, rules, ludoStats)

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white relative overflow-hidden">
      <GamePrimaryScreen
        config={config}
        backLabel={backLabel}
        onBack={onClose}
        onPlay={play}
        playLabel="Play Now"
        // §54 revised — the bottle icon INSIDE the button SPINS, rests, and
        // spins again (the game's own physics teasing from the CTA).
        playIcon={<AnimatedPlayIcon kind="bottle" />}
        playDisabled={finding}
        playTestId="spin-play-now"
        coinBalance={coinBalance}
        onBuyCoins={() => setCoinStoreOpen(true)}
        failed={failed}
        failHint="We couldn't load your stats."
      />

      {/* Matchmaking MODAL (§7) — the SHARED one-for-all-games modal: real
          profile photo, slow rotating status text, animated progress bar.
          The join request runs underneath; on success the user lands in the
          game room. */}
      <MatchmakingModal
        open={finding}
        userName={user?.name}
        userAvatar={avatar}
        level={level}
        messages={[
          'Getting the bottle ready…',
          'Finding your room…',
          'Looking for players…',
          'Checking the table…',
          'Setting the mood…',
          'Preparing the spin…',
          'Almost ready…',
          'The bottle is waiting…',
        ]}
        onCancel={cancelMatchmaking}
      />

      {/* Refactor PRD §24 — Coin Purchase modal (same sheet as in-room). */}
      <CoinStoreSheet
        open={coinStoreOpen}
        onClose={() => setCoinStoreOpen(false)}
        coinBalance={coinBalance}
        onPurchased={(nb) => setCoinBalance(nb)}
      />
    </div>
  )
}
