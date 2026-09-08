'use client'

// Quicky — Spin the Bottle landing page
// Shown when the user taps the "Spin the Bottle" entry card on the Community
// feed. Reads the user's game stats from /landing-stats, then offers a
// big "Play Now" CTA. The Play button matchmakes via /join and on success
// hands the resulting roomId to the parent so the room view can open.

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Sparkles, Loader2, Gamepad2, Dices, Heart, Coins, Lock, Check } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useQuickyStore } from '@/store/quicky'

type Stats = { gamesPlayed: number; kissesReceived: number; kissesGiven: number; coins: number; level: number }

const FINDING_MESSAGES = [
  'Finding a room…',
  'Looking for players…',
  'Joining the party…',
  'Almost ready…',
]

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

  useEffect(() => {
    if (!finding) return
    const t = setInterval(() => setMessageIdx((i) => (i + 1) % FINDING_MESSAGES.length), 900)
    return () => clearInterval(t)
  }, [finding])

  const play = async () => {
    if (finding) return
    setFinding(true)
    try {
      const res = await api.spinBottle.join()
      if (res?.roomId) onJoined(res.roomId)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to join a room')
      setFinding(false)
    }
  }

  const avatar = user?.photos?.find((p: any) => p.isPrimary)?.url ?? user?.photos?.[0]?.url
  const level = stats?.level ?? 1
  const game = user?.settings?.theme

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white relative overflow-hidden">
      {/* Ambient glows */}
      <motion.div
        className="absolute -top-24 -left-20 w-72 h-72 rounded-full bg-[var(--qk-accent)]/20 blur-3xl"
        animate={{ x: [0, 24, 0], y: [0, 16, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-24 -right-20 w-80 h-80 rounded-full bg-[var(--qk-purple)]/20 blur-3xl"
        animate={{ x: [0, -24, 0], y: [0, -16, 0] }}
        transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
      />

      <header className="shrink-0 safe-area-top px-3 pt-2.5 pb-2 flex items-center gap-2">
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
            <motion.div
              key="finding"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-5"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
                className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center glow-coral"
              >
                <Dices className="w-10 h-10 text-white" strokeWidth={1.75} />
              </motion.div>
              <AnimatePresence mode="wait">
                <motion.p
                  key={messageIdx}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="text-sm text-white/70"
                >
                  {FINDING_MESSAGES[messageIdx]}
                </motion.p>
              </AnimatePresence>
              <div className="w-44 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <motion.div
                  className="h-full bg-coral-gradient"
                  initial={{ width: '0%' }}
                  animate={{ width: ['0%', '92%'] }}
                  transition={{ duration: 4, ease: 'easeInOut' }}
                />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="lobby"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center gap-5"
            >
              {/* Hero card */}
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
                  <StatPill icon={<Sparkles className="w-4 h-4" />} label="Given" value={stats?.kissesGiven ?? 0} color="var(--qk-gold)" />
                  <StatPill icon={<Coins className="w-4 h-4" />} label="Coins" value={stats?.coins ?? 0} color="var(--qk-accent-light)" />
                </div>
              </div>

              <button
                onClick={play}
                className="bg-coral-gradient glow-coral rounded-2xl py-4 px-10 font-black text-lg tracking-wide active:scale-[0.98] transition-transform"
              >
                Play Now
              </button>

              {/* Rules card */}
              <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl p-4 text-sm text-white/70 leading-relaxed">
                <p className="text-white font-semibold mb-1.5">How it works</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Join a room with up to 12 players.</li>
                  <li>The system spins the bottle — you don't.</li>
                  <li>When the bottle points at you, say Kiss ❤️ or No Thanks ❌.</li>
                  <li>Opposite-gender target, 10s to respond.</li>
                </ul>
              </div>
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
      <p className="text-lg font-black mt-1">{value}</p>
      <p className="text-[10px] text-white/50 uppercase tracking-wide">{label}</p>
    </div>
  )
}
