'use client'

// Quicky — REWARDED AD MODAL (games)
//
// Entry points: the coin store (desktop modal + mobile sheet) and the realm
// leaderboard screen. Flow:
//   1. "Ad plays" — a 5s house placeholder (no skip: the reward REQUIRES the
//      full watch; the placeholder body is the seam where a real ad-network
//      SDK renders once available).
//   2. Completion → POST /api/quicky/ads/reward — the SERVER rolls the reward
//      (coins OR realm points, random order, random 1-1000) so the client can
//      never forge amounts. A 60s server cooldown gates farming (429).
//   3. Small reward modal: "You earned N coins / N Realm Points" + Collect →
//      stores update (coin balance / realm points) and the modal closes.
//
// Structure: the SHELL owns the AnimatePresence mount; the AD RUNNER mounts
// FRESH on every open (initial state = a new ad) — no reset effects.
//
// Used by: CoinStoreModal (desktop), CoinStoreSheet (mobile),
// RealmLeaderboardScreen (mobile + desktop).

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Coins, Sparkles, Play, Loader2, Crown } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { useRealmStore } from '@/store/realm'

const AD_DURATION_MS = 5000

type Phase = 'ad' | 'claiming' | 'reward' | 'error'

type Reward = { kind: 'COINS' | 'POINTS'; amount: number; coinBalance: number | null; cyclePoints: number | null }

export function RewardedAdModal({
  open,
  onClose,
  onRewarded,
}: {
  open: boolean
  onClose: () => void
  onRewarded?: (r: Reward) => void
}) {
  return (
    <AnimatePresence>
      {open && <AdRunner onClose={onClose} onRewarded={onRewarded} />}
    </AnimatePresence>
  )
}

/** One ad run — mounts fresh with initial state on every open. */
function AdRunner({ onClose, onRewarded }: { onClose: () => void; onRewarded?: (r: Reward) => void }) {
  const [phase, setPhase] = useState<Phase>('ad')
  const [remaining, setRemaining] = useState(AD_DURATION_MS)
  const [reward, setReward] = useState<Reward | null>(null)
  const [cooldownLeft, setCooldownLeft] = useState(0)
  const startedAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function claimReward() {
    setPhase('claiming')
    try {
      const res = await api.ads.reward()
      const r: Reward = { kind: res.kind, amount: res.amount, coinBalance: res.coinBalance ?? null, cyclePoints: res.cyclePoints ?? null }
      setReward(r)
      setPhase('reward')
    } catch (e: any) {
      if (e?.status === 429) {
        const retry = Number(e?.body?.retryAfterMs ?? 60000)
        setCooldownLeft(Math.ceil(retry / 1000))
        setPhase('error')
      } else {
        toast.error(e?.message ?? 'Could not collect the reward')
        onClose()
      }
    }
  }

  // The ad countdown — a plain interval over an external clock; state updates
  // happen in the (async) tick callback, never synchronously in the effect.
  useEffect(() => {
    startedAtRef.current = Date.now()
    timerRef.current = setInterval(() => {
      const left = Math.max(0, AD_DURATION_MS - (Date.now() - startedAtRef.current))
      setRemaining(left)
      if (left <= 0 && timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
        void claimReward()
      }
    }, 100)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const collect = () => {
    if (reward) {
      // Coins → the app-wide balance; points → the realm cycle counter.
      if (reward.kind === 'COINS' && reward.coinBalance != null) {
        const user = useQuickyStore.getState().user
        if (user) useQuickyStore.getState().setUser({ ...user, coinBalance: reward.coinBalance })
      } else if (reward.kind === 'POINTS') {
        useRealmStore.getState().applyPointPush(reward.amount, reward.cyclePoints ?? undefined)
      }
      onRewarded?.(reward)
    }
    onClose()
  }

  const progress = 1 - remaining / AD_DURATION_MS
  const R = 26
  const CIRC = 2 * Math.PI * R

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[230] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
      onClick={() => {
        // No tapping away mid-ad — the reward requires the full watch.
        if (phase === 'ad') return
        if (phase === 'reward') collect()
        else onClose()
      }}
      data-testid="rewarded-ad-modal"
      role="dialog"
      aria-label="Rewarded ad"
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-[var(--qk-card)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Phase: the ad itself ─────────────────────────────────── */}
        {phase === 'ad' && (
          <div className="relative bg-gradient-to-br from-[var(--qk-accent)]/30 via-[var(--qk-purple)]/25 to-black flex flex-col items-center gap-4 px-6 py-10 text-center">
            <span className="absolute top-3 left-3 text-[9px] font-black uppercase tracking-wider rounded-md border border-white/15 bg-black/40 px-1.5 py-0.5 text-white/70">
              Ad · 5s
            </span>

            <div className="w-20 h-20 rounded-3xl bg-black/30 border border-white/10 flex items-center justify-center">
              <Crown className="w-10 h-10 text-[var(--qk-gold)]" />
            </div>
            <h3 className="text-lg font-bold">Quicky Premium</h3>
            <p className="text-[13px] text-white/60 max-w-[34ch] leading-relaxed">
              Unlimited likes, exclusive themes and bonus coins — your reward is loading.
            </p>

            {/* countdown ring */}
            <div className="relative w-16 h-16 mt-1">
              <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
                <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="5" />
                <circle
                  cx="32"
                  cy="32"
                  r={R}
                  fill="none"
                  stroke="var(--qk-accent)"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={CIRC}
                  strokeDashoffset={CIRC * (1 - progress)}
                  style={{ transition: 'stroke-dashoffset 0.12s linear' }}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-black tabular-nums">
                {Math.ceil(remaining / 1000)}
              </span>
            </div>
            <p className="text-[10px] text-white/40 font-semibold">Reward unlocks on full watch</p>
          </div>
        )}

        {/* ── Phase: claiming ──────────────────────────────────────── */}
        {phase === 'claiming' && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--qk-accent)]" />
            <p className="text-sm font-semibold text-white/70">Rolling your reward…</p>
          </div>
        )}

        {/* ── Phase: the reward ────────────────────────────────────── */}
        {phase === 'reward' && reward && (
          <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
              className={`w-20 h-20 rounded-3xl flex items-center justify-center ${
                reward.kind === 'COINS' ? 'bg-amber-400/15 border border-amber-300/25' : 'bg-[var(--qk-accent)]/15 border border-[var(--qk-accent)]/25'
              }`}
            >
              {reward.kind === 'COINS' ? <Coins className="w-10 h-10 text-amber-300" /> : <Sparkles className="w-10 h-10 text-[var(--qk-accent)]" />}
            </motion.div>
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/40">Ad complete</p>
            <p className="text-2xl font-black tabular-nums">
              +{reward.amount.toLocaleString()} {reward.kind === 'COINS' ? 'coins' : 'Realm Points'}
            </p>
            <p className="text-xs text-white/50">
              {reward.kind === 'COINS'
                ? 'Added to your coin balance — spend it on kisses, gifts and table perks.'
                : 'Added to your current realm cycle — climb toward the Top 3!'}
            </p>
            <button
              onClick={collect}
              className="w-full rounded-2xl bg-coral-gradient py-3 font-black tracking-wide active:scale-[0.98] transition-transform"
              data-testid="rewarded-ad-collect"
            >
              COLLECT
            </button>
          </div>
        )}

        {/* ── Phase: cooldown (server 429) ─────────────────────────── */}
        {phase === 'error' && (
          <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
            <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center">
              <Play className="w-8 h-8 text-white/40" />
            </div>
            <p className="text-sm font-bold">You&apos;ve just claimed an ad reward</p>
            <p className="text-xs text-white/50">
              Next rewarded ad unlocks in <b className="text-white tabular-nums">{cooldownLeft}s</b> — come back shortly.
            </p>
            <button onClick={onClose} className="w-full rounded-2xl bg-white/8 hover:bg-white/12 py-3 font-bold text-sm transition-colors">
              Maybe later
            </button>
          </div>
        )}

        {phase === 'ad' && (
          <button
            onClick={onClose}
            className="absolute top-2.5 right-2.5 p-1.5 rounded-full bg-black/40 hover:bg-black/60 text-white/70"
            aria-label="Cancel ad (no reward)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </motion.div>
    </motion.div>
  )
}
