'use client'

// Quicky — Spin the Bottle landing page (v3 PRD §3-§19, §79)
// Shown when the user taps the "Spin the Bottle" entry card on the Community
// feed. Displays DATABASE-DRIVEN profile stats (kisses, games, coins, gifts
// sent/received — /landing-stats), then the big "Play Now" CTA opens a
// DEDICATED MATCHMAKING SCREEN (§7/§8): the user's real profile photo, name
// and stat row, with slow, playful rotating status text (~1.7s visible +
// ~0.5s transitions — never rapidly flashing, §9-§11) and a Cancel button.
//
// Back (§4-§6): the header arrow calls onClose → explicit setView('community')
// — never a visual-only element, never a duplicate-history router.back().

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Sparkles, Gamepad2, Dices, Heart, Coins, Gift } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { useQuickyStore } from '@/store/quicky'
import { HowItWorksRules } from './HowItWorksRules'
import { GameChatList } from './game-chat/GameChatList'

type Stats = {
  gamesPlayed: number
  kissesReceived: number
  kissesGiven: number
  giftsSent: number
  giftsReceived: number
  coins: number
  level: number
}

// v3 §10 — bigger pool, sequentially cycled.
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
}: {
  onClose: () => void
  onJoined: (roomId: string) => void
}) {
  const user = useQuickyStore((s) => s.user)
  const [stats, setStats] = useState<Stats | null>(null)
  const [finding, setFinding] = useState(false)
  const [messageIdx, setMessageIdx] = useState(0)
  const cancelledRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.spinBottle.landing()
        if (!cancelled) setStats(res)
      } catch (e: any) {
        if (!cancelled) toast.error(e.message ?? 'Failed to load stats')
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

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white relative overflow-hidden">
      {/* Ambient glows — decorative only: pointer-events-none so they can
          NEVER swallow taps meant for the header back arrow (lifecycle §54). */}
      <motion.div
        className="pointer-events-none absolute -top-24 -left-20 w-72 h-72 rounded-full bg-[var(--qk-accent)]/20 blur-3xl"
        animate={{ x: [0, 24, 0], y: [0, 16, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none absolute -bottom-24 -right-20 w-80 h-80 rounded-full bg-[var(--qk-purple)]/20 blur-3xl"
        animate={{ x: [0, -24, 0], y: [0, -16, 0] }}
        transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
      />

      <header className="shrink-0 safe-area-top px-3 pt-2.5 pb-2 flex items-center gap-2 relative z-20">
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-white/10"
          aria-label="Back to Community"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold">Spin the Bottle</h1>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar relative z-10 px-5 pb-8">
                {/* Lobby — full-width two-column stage on web, single column on
            mobile. Always mounted: Play Now opens the matchmaking MODAL on
            top instead of replacing the whole page with a loading screen. */}
        <motion.div
          key="lobby"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-[1200px] mx-auto grid lg:grid-cols-[1fr_360px] gap-8 items-start"
          data-testid="spin-landing-lobby"
        >
          {/* Left: hero + CTA + rules */}
          <div className="flex flex-col items-center gap-5 min-w-0">
            <div className="w-full max-w-sm lg:max-w-none bg-[var(--qk-card)] border border-white/10 rounded-3xl p-5 lg:p-7 flex flex-col lg:flex-row items-center lg:items-center gap-6">
              <div className="w-20 h-20 lg:w-24 lg:h-24 shrink-0 rounded-full overflow-hidden border-2 border-[var(--qk-accent)]/50 bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center">
                {avatar ? (
                  <img src={avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl font-black text-white">
                    {(user?.name ?? '?').slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex-1 w-full">
                <h2 className="text-xl font-bold lg:text-2xl text-center lg:text-left">{user?.name ?? 'You'}</h2>
                <p className="text-xs text-white/50 mt-0.5 text-center lg:text-left">Level {level}</p>
                <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mt-5 w-full">
                  <StatPill icon={<Heart className="w-4 h-4" />} label="Kisses" value={stats?.kissesReceived ?? 0} color="var(--qk-accent)" />
                  <StatPill icon={<Gamepad2 className="w-4 h-4" />} label="Games" value={stats?.gamesPlayed ?? 0} color="var(--qk-purple)" />
                  <StatPill icon={<Coins className="w-4 h-4" />} label="Coins" value={stats?.coins ?? 0} color="var(--qk-accent-light)" />
                  <StatPill icon={<Sparkles className="w-4 h-4" />} label="Given" value={stats?.kissesGiven ?? 0} color="var(--qk-gold)" />
                  <StatPill icon={<Gift className="w-4 h-4" />} label="Gifts Sent" value={stats?.giftsSent ?? 0} color="#f472b6" />
                  <StatPill icon={<Gift className="w-4 h-4" />} label="Gifts Got" value={stats?.giftsReceived ?? 0} color="#38bdf8" />
                </div>
              </div>
            </div>

            <button
              onClick={play}
              className="bg-coral-gradient glow-coral rounded-2xl py-4 px-14 font-black text-lg tracking-wide active:scale-[0.98] transition-transform"
              data-testid="spin-play-now"
            >
              Play Now
            </button>

            {/* Lifecycle PRD §38-§53: ONE admin-managed rule at a time */}
            <HowItWorksRules />
          </div>

          {/* Right column on web / below on mobile: game chats (§8) */}
          <div className="w-full min-w-0">
            <GameChatList />
          </div>
        </motion.div>
      </div>

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
                <span className="bg-white/5 border border-white/10 rounded-full px-2.5 py-1">
                  🪙 <b className="tabular-nums">{(stats?.coins ?? 0).toLocaleString('en-US')}</b>
                </span>
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
    </div>
  )
}

function StatPill({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number
  color: string
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-3 flex flex-col items-center">
      <span style={{ color }}>{icon}</span>
      <p className="text-lg font-black mt-1 tabular-nums">{value.toLocaleString('en-US')}</p>
      <p className="text-[10px] text-white/50 uppercase tracking-wide">{label}</p>
    </div>
  )
}
