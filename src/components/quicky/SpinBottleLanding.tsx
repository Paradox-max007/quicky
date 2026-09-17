'use client'

// Quicky — Spin the Bottle landing (Unified Game Primary Screen PRD §1/§55/§57)
//
// This is now a thin GAME ADAPTER around the reusable GamePrimaryScreen:
// it fetches the Spin the Bottle data (landing stats, admin rules, catalog
// entry), builds the GamePrimaryConfig and wires the REAL matchmaking flow
// (v3 PRD §7/§8 matchmaking modal → join API → room). The screen itself —
// hero, profile/stat card with 💬/👥 icons, combined stats, rotating texts,
// progress, how-it-works — is rendered by GamePrimaryScreen for EVERY game.
//
// The old bottom Game Chats section is REMOVED (Unified PRD §11): chat lives
// behind the 💬 icon (GameInteractionPanel on web / dedicated contacts screen
// on Capacitor), friends behind the 👥 icon.
//
// Back (§4-§6 v3): the header arrow calls onClose → explicit setView — never
// a visual-only element, never a duplicate-history router.back().

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { CoinStoreSheet } from './CoinStoreSheet'
import { GamePrimaryScreen } from './game-primary/GamePrimaryScreen'
import {
  buildSpinPrimaryConfig,
  type GameDef,
  type GameHowItWorksStep,
  type LudoLandingStats,
  type SpinLandingStats,
} from './game-primary/game-configs'

// v3 §10 — bigger pool, sequentially cycled (matchmaking modal only).
const FINDING_MESSAGES = [
  'Getting the bottle ready…',
  'Finding your room…',
  'Looking for players…',
  'Checking the table…',
  'Setting the mood…',
  'Finding your game…',
  'Mixing the room…',
  'Preparing the spin…',
  'Almost ready…',
  'The bottle is waiting…',
]
// v3 §9 — one message every ~1.7s with a ~0.5s fade (AnimatePresence "wait").
const MSG_VISIBLE_MS = 1700

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
  const [messageIdx, setMessageIdx] = useState(0)
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

  // Slow, deliberate rotation (§8-§11) — ONLY while matchmaking.
  useEffect(() => {
    if (!finding) return
    const t = setInterval(() => setMessageIdx((i) => (i + 1) % FINDING_MESSAGES.length), MSG_VISIBLE_MS)
    return () => clearInterval(t)
  }, [finding])

  const play = () => {
    if (finding) return
    setFinding(true)
    cancelledRef.current = false
    setMessageIdx(0)
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
        playDisabled={finding}
        playTestId="spin-play-now"
        coinBalance={coinBalance}
        onBuyCoins={() => setCoinStoreOpen(true)}
        failed={failed}
        failHint="We couldn't load your stats."
      />

      {/* Matchmaking MODAL (§7): real profile photo, live DB stats, slow
          rotating status text and an animated progress bar — the join request
          runs underneath; on success the user lands in the game room. */}
      <AnimatePresence>
        {finding && (
          <motion.div
            key="matchmaking-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
            data-testid="matchmaking-modal"
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-sm bg-[var(--qk-card)] border border-white/10 rounded-3xl p-7 flex flex-col items-center text-center shadow-2xl"
            >
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 220, damping: 18 }}
                className="w-20 h-20 rounded-3xl overflow-hidden border-2 border-[var(--qk-accent)]/60 bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center glow-coral"
              >
                {avatar ? (
                  <img src={avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl font-black text-white">
                    {(user?.name ?? '?').slice(0, 1).toUpperCase()}
                  </span>
                )}
              </motion.div>
              <h2 className="text-xl font-black mt-3">{user?.name ?? 'You'}</h2>
              <p className="text-xs text-white/50 mt-0.5">Level {level}</p>

              {/* Live DB stats row (§14/§16) */}
              <div className="flex items-center gap-1.5 text-xs mt-3 flex-wrap justify-center">
                <span className="bg-white/5 border border-white/10 rounded-full px-2.5 py-1">
                  ❤️ <b className="tabular-nums">{stats?.kissesReceived ?? 0}</b>
                </span>
                <span className="bg-white/5 border border-white/10 rounded-full px-2.5 py-1">
                  🎮 <b className="tabular-nums">{stats?.gamesPlayed ?? 0}</b>
                </span>
                <button
                  onClick={() => setCoinStoreOpen(true)}
                  className="bg-white/5 border border-white/10 rounded-full px-2.5 py-1 active:scale-95 transition-transform"
                  aria-label="Buy coins"
                >
                  🪙 <b className="tabular-nums">{(stats?.coins ?? 0).toLocaleString('en-US')}</b>
                  <span className="ml-1 text-[var(--qk-accent-light)] font-black">+</span>
                </button>
              </div>

              {/* One message at a time (§11), ~1.7s visible + ~0.5s fade (§9) */}
              <div className="h-6 flex items-center justify-center mt-4">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={messageIdx}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.5, ease: 'easeInOut' }}
                    className="text-sm text-white/75 font-medium"
                  >
                    {FINDING_MESSAGES[messageIdx]}
                  </motion.p>
                </AnimatePresence>
              </div>

              {/* Animated progress bar — fills to 94% and holds while joining */}
              <div className="w-48 h-1.5 rounded-full bg-white/10 overflow-hidden mt-2" data-testid="matchmaking-progress">
                <motion.div
                  className="h-full bg-coral-gradient"
                  initial={{ width: '0%' }}
                  animate={{ width: ['0%', '94%'] }}
                  transition={{ duration: 12, ease: 'easeInOut' }}
                />
              </div>

              <button
                onClick={cancelMatchmaking}
                className="mt-4 text-sm font-semibold text-white/60 hover:text-white px-6 py-2.5 rounded-full border border-white/10 hover:border-white/25 transition-colors"
                data-testid="matchmaking-cancel"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
