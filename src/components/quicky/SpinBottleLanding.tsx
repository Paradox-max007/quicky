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
        <AnimatePresence mode="wait">
          {finding ? (
            /* ═══ MATCHMAKING SCREEN (§7/§12/§14/§16) — real profile photo,
                   real name, real DB stats, slow playful text ═══ */
            <motion.div
              key="matchmaking"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center min-h-[62vh] text-center gap-4"
            >
              {/* Profile photo — the authenticated user's real picture */}
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 220, damping: 18 }}
                className="w-24 h-24 rounded-3xl overflow-hidden border-2 border-[var(--qk-accent)]/60 bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center glow-coral"
              >
                {avatar ? (
                  <img src={avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl font-black text-white">
                    {(user?.name ?? '?').slice(0, 1).toUpperCase()}
                  </span>
                )}
              </motion.div>
              <div>
                <h2 className="text-xl font-black">{user?.name ?? 'You'}</h2>
                <p className="text-xs text-white/50 mt-0.5">Level {level}</p>
              </div>

              {/* Live DB stats row (§14/§16) */}
              <div className="flex items-center gap-2 text-sm">
                <span className="bg-white/5 border border-white/10 rounded-full px-3 py-1.5 flex items-center gap-1.5">
                  ❤️ <b className="tabular-nums">{stats?.kissesReceived ?? 0}</b>
                </span>
                <span className="bg-white/5 border border-white/10 rounded-full px-3 py-1.5 flex items-center gap-1.5">
                  🎮 <b className="tabular-nums">{stats?.gamesPlayed ?? 0}</b>
                </span>
                <span className="bg-white/5 border border-white/10 rounded-full px-3 py-1.5 flex items-center gap-1.5">
                  🪙 <b className="tabular-nums">{(stats?.coins ?? 0).toLocaleString('en-US')}</b>
                </span>
                <span className="bg-white/5 border border-white/10 rounded-full px-3 py-1.5 flex items-center gap-1.5">
                  🎁 <b className="tabular-nums">{stats?.giftsReceived ?? 0}</b>
                </span>
              </div>

              {/* One message at a time (§11), ~1.7s visible + ~0.5s fade (§9) */}
              <div className="h-6 flex items-center justify-center mt-1">
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

              <div className="w-44 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <motion.div
                  className="h-full bg-coral-gradient"
                  initial={{ width: '0%' }}
                  animate={{ width: ['0%', '94%'] }}
                  transition={{ duration: 12, ease: 'easeInOut' }}
                />
              </div>

              <button
                onClick={cancelMatchmaking}
                className="mt-2 text-sm font-semibold text-white/60 hover:text-white px-6 py-2.5 rounded-full border border-white/10 hover:border-white/25 transition-colors"
              >
                Cancel
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="lobby"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center gap-5"
            >
              {/* Hero card — real DB stats (§15/§17/§79) */}
              <div className="w-full max-w-sm bg-[var(--qk-card)] border border-white/10 rounded-3xl p-5 flex flex-col items-center text-center mt-2">
                <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-[var(--qk-accent)]/50 bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center">
                  {avatar ? (
                    <img src={avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl font-black text-white">
                      {(user?.name ?? '?').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </div>
                <h2 className="text-xl font-bold mt-3">{user?.name ?? 'You'}</h2>
                <p className="text-xs text-white/50 mt-0.5">Level {level}</p>
                <div className="grid grid-cols-2 gap-3 mt-5 w-full">
                  <StatPill icon={<Heart className="w-4 h-4" />} label="Kisses" value={stats?.kissesReceived ?? 0} color="var(--qk-accent)" />
                  <StatPill icon={<Gamepad2 className="w-4 h-4" />} label="Games" value={stats?.gamesPlayed ?? 0} color="var(--qk-purple)" />
                  <StatPill icon={<Coins className="w-4 h-4" />} label="Coins" value={stats?.coins ?? 0} color="var(--qk-accent-light)" />
                  <StatPill icon={<Sparkles className="w-4 h-4" />} label="Given" value={stats?.kissesGiven ?? 0} color="var(--qk-gold)" />
                </div>
                {/* Gift totals — counts, not coin values (§17/§18) */}
                <div className="grid grid-cols-2 gap-3 mt-3 w-full">
                  <StatPill icon={<Gift className="w-4 h-4" />} label="Gifts Sent" value={stats?.giftsSent ?? 0} color="#f472b6" />
                  <StatPill icon={<Gift className="w-4 h-4" />} label="Gifts Received" value={stats?.giftsReceived ?? 0} color="#38bdf8" />
                </div>
              </div>

              <button
                onClick={play}
                className="bg-coral-gradient glow-coral rounded-2xl py-4 px-10 font-black text-lg tracking-wide active:scale-[0.98] transition-transform"
              >
                Play Now
              </button>

              {/* Lifecycle PRD §38-§53: ONE admin-managed rule at a time,
                  slow readable rotation, stable height — DB-driven via
                  /games/spin-bottle/rules (fallback copy if empty). */}
              <HowItWorksRules />

              {/* game-chat PRD §8: Game Chats live INSIDE the Spin the
                  Bottle section, separate from Dating → Chats (§7). */}
              <GameChatList />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
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
