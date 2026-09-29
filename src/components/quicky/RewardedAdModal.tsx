'use client'

// Quicky — REWARDED AD MODAL (Monetization PRD §3)
//
// REAL rewarded ads with a server-authoritative session flow:
//   1. Reward-type selector — Coins or Realm Points, chosen BEFORE the ad
//      starts (PRD §3.1). Range comes from the server config.
//   2. POST /api/quicky/rewards/session → pending session (limits + cooldown
//      enforced server-side).
//   3. The PROVIDER plays the ad:
//        · admob  — native AdMob rewarded ad (SSV carries the session id)
//        · web_ad — Google Ad Manager rewarded slot
//        · mock   — dev-only 5s house demo (server-gated by
//                   ALLOW_MOCK_REWARDED_ADS; never in production)
//   4. Verifying — the client POLLS the session; currency moves only when
//      the provider's SIGNED callback reaches the backend (AdMob SSV /
//      HMAC web callback). A timeout shows "reward pending", never a fake
//      success (PRD §3.4 / §4.3).
//   5. Success — amount (10–100, server-rolled once) + updated balance.
//
// States (PRD §3.4): ready / loading / playing / verifying / success /
// no-inventory / daily-limit / cooldown / cancelled / pending / error.
//
// Used by: GameStoreTabs (coin store), RealmLeaderboardScreen.

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Coins, Sparkles, Play, Loader2, Crown, Clock, Ban, CheckCircle2, Hourglass, AlertTriangle } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { isNative, getPlatform } from '@/lib/capacitor'
import { getRewardedAdProvider } from '@/lib/quicky/rewards/providers'
import { useQuickyStore } from '@/store/quicky'
import { useRealmStore } from '@/store/realm'

type Phase = 'boot' | 'select' | 'loading' | 'playing' | 'verifying' | 'success' | 'unavailable' | 'limit' | 'cooldown' | 'cancelled' | 'pending' | 'error'

type RewardType = 'COINS' | 'REALM_POINTS'

type Reward = { kind: 'COINS' | 'POINTS'; amount: number; coinBalance: number | null; cyclePoints: number | null }

type StatusInfo = Awaited<ReturnType<typeof api.rewardedAds.status>>

const MOCK_AD_DURATION_MS = 5000
const VERIFY_POLL_MS = 1500
const VERIFY_TIMEOUT_MS = 30_000

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
      {open && <AdRunner key="ad-runner" onClose={onClose} onRewarded={onRewarded} />}
    </AnimatePresence>
  )
}

/** One ad flow — mounts fresh with initial state on every open. */
function AdRunner({ onClose, onRewarded }: { onClose: () => void; onRewarded?: (r: Reward) => void }) {
  const [phase, setPhase] = useState<Phase>('boot')
  const [status, setStatus] = useState<StatusInfo | null>(null)
  const [rewardType, setRewardType] = useState<RewardType>('COINS')
  const [reward, setReward] = useState<Reward | null>(null)
  const [cooldownLeft, setCooldownLeft] = useState(0)
  const [pendingNote, setPendingNote] = useState('')
  const [mockRemaining, setMockRemaining] = useState(MOCK_AD_DURATION_MS)

  const platform: 'web' | 'android' | 'ios' = isNative() ? getPlatform() : 'web'
  const mountedRef = useRef(true)
  const startedAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const applyReward = useCallback((r: Reward) => {
    if (r.kind === 'COINS' && r.coinBalance != null) {
      const user = useQuickyStore.getState().user
      if (user) useQuickyStore.getState().setUser({ ...user, coinBalance: r.coinBalance })
    } else if (r.kind === 'POINTS') {
      useRealmStore.getState().applyPointPush(r.amount, r.cyclePoints ?? undefined)
    }
    onRewarded?.(r)
  }, [onRewarded])

  // ── 1. Boot: eligibility ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const s = await api.rewardedAds.status(platform)
        if (cancelled || !mountedRef.current) return
        setStatus(s)
        if (!s.canWatch) {
          if (s.reason === 'daily_limit') setPhase('limit')
          else if (s.reason === 'cooldown') {
            setCooldownLeft(Math.ceil((s.cooldownRemainingMs ?? 0) / 1000))
            setPhase('cooldown')
          } else setPhase('unavailable')
          return
        }
        // Default selection: keep the previous pick when still enabled.
        if (rewardType === 'COINS' && !s.config.coinsEnabled && s.config.pointsEnabled) setRewardType('REALM_POINTS')
        if (rewardType === 'REALM_POINTS' && !s.config.pointsEnabled && s.config.coinsEnabled) setRewardType('COINS')
        setPhase('select')
      } catch {
        if (!cancelled && mountedRef.current) setPhase('unavailable')
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cooldown countdown display
  useEffect(() => {
    if (phase !== 'cooldown') return
    const t = setInterval(() => setCooldownLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [phase])

  // ── 2. Session poller (verifying) ────────────────────────────────────────
  const pollSession = useCallback(async (sessionId: string) => {
    const deadline = Date.now() + VERIFY_TIMEOUT_MS
    while (mountedRef.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, VERIFY_POLL_MS))
      if (!mountedRef.current) return
      try {
        const { session } = await api.rewardedAds.getSession(sessionId)
        if (session.status === 'COMPLETED') {
          const r: Reward = {
            kind: session.rewardType === 'COINS' ? 'COINS' : 'POINTS',
            amount: session.rewardAmount ?? 0,
            coinBalance: session.coinBalance ?? null,
            cyclePoints: session.cyclePoints ?? null,
          }
          setReward(r)
          applyReward(r)
          setPhase('success')
          return
        }
        if (session.status === 'FAILED' || session.status === 'EXPIRED') {
          setPendingNote('The ad could not be verified. No reward was issued.')
          setPhase('error')
          return
        }
        // still PENDING → keep polling
      } catch {
        // transient poll error → keep trying until the deadline
      }
    }
    if (mountedRef.current) {
      setPendingNote('Your reward is still being confirmed — it will land in your balance shortly.')
      setPhase('pending')
    }
  }, [applyReward])

  // ── 3. Watch flow ────────────────────────────────────────────────────────
  const watch = useCallback(async () => {
    setPhase('loading')
    let sessionId: string | null = null
    try {
      const s = await api.rewardedAds.createSession(rewardType === 'COINS' ? 'coins' : 'realm_points', platform)
      sessionId = s.sessionId
    } catch (e: any) {
      if (e?.status === 429 || e?.status === 409) {
        // daily limit / cooldown / concurrent session surfaced at start time
        setCooldownLeft(Math.ceil(Number(e?.body?.retryAfterMs ?? 30000) / 1000))
        setPhase(e?.body?.error === 'daily_limit' ? 'limit' : 'cooldown')
      } else {
        setPendingNote(e?.message ?? 'Could not start the ad.')
        setPhase('error')
      }
      return
    }

    const provider = getRewardedAdProvider(status?.provider ?? null, (resolve) => {
      // mock: 5s house demo countdown, then complete
      setPhase('playing')
      startedAtRef.current = Date.now()
      timerRef.current = setInterval(() => {
        const left = Math.max(0, MOCK_AD_DURATION_MS - (Date.now() - startedAtRef.current))
        setMockRemaining(left)
        if (left <= 0 && timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
          resolve({ type: 'completed' })
        }
      }, 100)
    })

    if (!provider) {
      await api.rewardedAds.cancelSession(sessionId).catch(() => {})
      setPhase('unavailable')
      return
    }

    const available = await provider.isAvailable().catch(() => false)
    if (!available) {
      await api.rewardedAds.cancelSession(sessionId).catch(() => {})
      setPhase('unavailable')
      return
    }

    setPhase('playing')
    const event = await provider.show({ rewardSessionId: sessionId, rewardType })

    if (event.type === 'dismissed') {
      await api.rewardedAds.cancelSession(sessionId).catch(() => {})
      setPhase('cancelled')
      return
    }
    if (event.type === 'failed') {
      await api.rewardedAds.cancelSession(sessionId).catch(() => {})
      setPendingNote('No ads available right now. Please try again later.')
      setPhase('unavailable')
      return
    }

    // completed → verify. Mock completes synchronously server-side; real
    // providers rely on the signed SSV/web callback reaching the backend.
    if (provider.kind === 'mock') {
      setPhase('verifying')
      try {
        const res = await api.rewardedAds.mockComplete(sessionId)
        const r: Reward = {
          kind: res.rewardType === 'COINS' ? 'COINS' : 'POINTS',
          amount: res.rewardAmount,
          coinBalance: res.coinBalance ?? null,
          cyclePoints: res.cyclePoints ?? null,
        }
        setReward(r)
        applyReward(r)
        setPhase('success')
      } catch (e: any) {
        setPendingNote(e?.message ?? 'Could not collect the reward.')
        setPhase('error')
      }
      return
    }

    setPhase('verifying')
    void pollSession(sessionId)
  }, [rewardType, platform, status, applyReward, pollSession])

  const collect = () => onClose()

  const cfg = status?.config
  const rangeLabel = cfg ? `${cfg.minReward}–${cfg.maxReward}` : '10–100'
  const progress = 1 - mockRemaining / MOCK_AD_DURATION_MS
  const R = 26
  const CIRC = 2 * Math.PI * R

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[230] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
      onClick={() => {
        if (phase === 'playing') return // no tapping away mid-ad
        if (phase === 'success') collect()
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
        {/* ── Phase: boot ─────────────────────────────────────────── */}
        {phase === 'boot' && (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--qk-accent)]" />
            <p className="text-sm font-semibold text-white/70">Checking your rewards…</p>
          </div>
        )}

        {/* ── Phase: reward-type selector (PRD §3.1) ─────────────── */}
        {phase === 'select' && (
          <div className="flex flex-col gap-4 px-6 py-7">
            <div className="text-center">
              <h3 className="text-lg font-black">Earn free rewards</h3>
              <p className="text-[13px] text-white/55 mt-1">
                Choose your reward, watch an ad to the end and collect <b className="text-white/80">{rangeLabel}</b>.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => cfg?.coinsEnabled && setRewardType('COINS')}
                disabled={!cfg?.coinsEnabled}
                className={`rounded-2xl border p-4 flex flex-col items-center gap-2 transition-all ${
                  rewardType === 'COINS'
                    ? 'border-[var(--qk-gold)]/60 bg-amber-400/10'
                    : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                } ${!cfg?.coinsEnabled ? 'opacity-40' : ''}`}
                data-testid="reward-type-coins"
              >
                <Coins className={`w-7 h-7 ${rewardType === 'COINS' ? 'text-amber-300' : 'text-white/60'}`} />
                <span className="text-[13px] font-bold">Quicky Coins</span>
                <span className="text-[10px] text-white/45">{cfg?.coinsEnabled ? `Random ${rangeLabel}` : 'Unavailable'}</span>
              </button>
              <button
                onClick={() => cfg?.pointsEnabled && setRewardType('REALM_POINTS')}
                disabled={!cfg?.pointsEnabled}
                className={`rounded-2xl border p-4 flex flex-col items-center gap-2 transition-all ${
                  rewardType === 'REALM_POINTS'
                    ? 'border-[var(--qk-accent)]/60 bg-[var(--qk-accent)]/10'
                    : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                } ${!cfg?.pointsEnabled ? 'opacity-40' : ''}`}
                data-testid="reward-type-points"
              >
                <Sparkles className={`w-7 h-7 ${rewardType === 'REALM_POINTS' ? 'text-[var(--qk-accent)]' : 'text-white/60'}`} />
                <span className="text-[13px] font-bold">Realm Points</span>
                <span className="text-[10px] text-white/45">{cfg?.pointsEnabled ? `Random ${rangeLabel}` : 'Unavailable'}</span>
              </button>
            </div>

            <button
              onClick={watch}
              className="w-full rounded-2xl bg-coral-gradient py-3 font-black tracking-wide active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              data-testid="watch-ad-cta"
            >
              <Play className="w-4 h-4 fill-current" />
              WATCH AD
            </button>
            <p className="text-[10px] text-white/35 text-center">
              {status?.adsToday != null && status?.dailyLimit ? `Today: ${status.adsToday}/${status.dailyLimit} ads watched` : 'Reward is issued after the ad is verified'}
            </p>
          </div>
        )}

        {/* ── Phase: loading ad ───────────────────────────────────── */}
        {phase === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--qk-accent)]" />
            <p className="text-sm font-semibold text-white/70">Loading ad…</p>
          </div>
        )}

        {/* ── Phase: playing (dev mock house ad) ──────────────────── */}
        {phase === 'playing' && status?.provider === 'mock' && (
          <div className="relative bg-gradient-to-br from-[var(--qk-accent)]/30 via-[var(--qk-purple)]/25 to-black flex flex-col items-center gap-4 px-6 py-10 text-center">
            <span className="absolute top-3 left-3 text-[9px] font-black uppercase tracking-wider rounded-md border border-white/15 bg-black/40 px-1.5 py-0.5 text-white/70">
              Dev demo ad · 5s
            </span>
            <div className="w-20 h-20 rounded-3xl bg-black/30 border border-white/10 flex items-center justify-center">
              <Crown className="w-10 h-10 text-[var(--qk-gold)]" />
            </div>
            <h3 className="text-lg font-bold">Quicky Premium</h3>
            <p className="text-[13px] text-white/60 max-w-[34ch] leading-relaxed">
              Unlimited likes, exclusive themes and bonus coins — your reward is loading.
            </p>
            <div className="relative w-16 h-16 mt-1">
              <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
                <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="5" />
                <circle
                  cx="32" cy="32" r={R} fill="none" stroke="var(--qk-accent)" strokeWidth="5" strokeLinecap="round"
                  strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - progress)}
                  style={{ transition: 'stroke-dashoffset 0.12s linear' }}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-black tabular-nums">
                {Math.ceil(mockRemaining / 1000)}
              </span>
            </div>
            <p className="text-[10px] text-white/40 font-semibold">Reward unlocks on full watch</p>
          </div>
        )}

        {/* ── Phase: playing (real provider renders its own fullscreen) ── */}
        {phase === 'playing' && status?.provider !== 'mock' && (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--qk-accent)]" />
            <p className="text-sm font-semibold text-white/70">Your ad is playing…</p>
            <p className="text-[11px] text-white/40">Keep watching to the end to earn your reward</p>
          </div>
        )}

        {/* ── Phase: verifying (PRD §4.3 — server confirms) ───────── */}
        {phase === 'verifying' && (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <Hourglass className="w-8 h-8 animate-pulse text-[var(--qk-accent)]" />
            <p className="text-sm font-semibold text-white/70">Verifying reward…</p>
            <p className="text-[11px] text-white/40">Confirming your ad completion</p>
          </div>
        )}

        {/* ── Phase: the reward ────────────────────────────────────── */}
        {phase === 'success' && reward && (
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

        {/* ── Phase: no inventory (PRD §3.4) ───────────────────────── */}
        {phase === 'unavailable' && (
          <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
            <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center">
              <Ban className="w-8 h-8 text-white/40" />
            </div>
            <p className="text-sm font-bold">No ads available</p>
            <p className="text-xs text-white/50">{pendingNote || 'No ads available right now. Try again later.'}</p>
            <button onClick={onClose} className="w-full rounded-2xl bg-white/8 hover:bg-white/12 py-3 font-bold text-sm transition-colors">
              Close
            </button>
          </div>
        )}

        {/* ── Phase: daily limit ───────────────────────────────────── */}
        {phase === 'limit' && (
          <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
            <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center">
              <Clock className="w-8 h-8 text-white/40" />
            </div>
            <p className="text-sm font-bold">Daily ad limit reached</p>
            <p className="text-xs text-white/50">
              You&apos;ve watched {status?.adsToday ?? 'all'} of your {status?.dailyLimit ?? 10} daily rewarded ads. Come back tomorrow for more.
            </p>
            <button onClick={onClose} className="w-full rounded-2xl bg-white/8 hover:bg-white/12 py-3 font-bold text-sm transition-colors">
              Got it
            </button>
          </div>
        )}

        {/* ── Phase: cooldown ──────────────────────────────────────── */}
        {phase === 'cooldown' && (
          <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
            <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center">
              <Clock className="w-8 h-8 text-white/40" />
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

        {/* ── Phase: cancelled (no reward) ─────────────────────────── */}
        {phase === 'cancelled' && (
          <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
            <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center">
              <X className="w-8 h-8 text-white/40" />
            </div>
            <p className="text-sm font-bold">Ad closed early</p>
            <p className="text-xs text-white/50">No reward this time — watch the full ad to earn your coins or points.</p>
            <button onClick={onClose} className="w-full rounded-2xl bg-white/8 hover:bg-white/12 py-3 font-bold text-sm transition-colors">
              Okay
            </button>
          </div>
        )}

        {/* ── Phase: verification pending (PRD §3.4) ───────────────── */}
        {phase === 'pending' && (
          <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
            <div className="w-16 h-16 rounded-3xl bg-[var(--qk-accent)]/10 border border-[var(--qk-accent)]/20 flex items-center justify-center">
              <Hourglass className="w-8 h-8 text-[var(--qk-accent)]" />
            </div>
            <p className="text-sm font-bold">Reward pending</p>
            <p className="text-xs text-white/50">
              {pendingNote || 'Your reward is still being confirmed — it will appear in your balance shortly.'}
            </p>
            <button onClick={onClose} className="w-full rounded-2xl bg-white/8 hover:bg-white/12 py-3 font-bold text-sm transition-colors">
              Close
            </button>
          </div>
        )}

        {/* ── Phase: error (retry safe) ────────────────────────────── */}
        {phase === 'error' && (
          <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
            <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-white/40" />
            </div>
            <p className="text-sm font-bold">Something went wrong</p>
            <p className="text-xs text-white/50">{pendingNote || 'The reward could not be issued. Please try again.'}</p>
            <button
              onClick={() => setPhase('select')}
              className="w-full rounded-2xl bg-coral-gradient py-3 font-black text-sm tracking-wide active:scale-[0.98] transition-transform"
            >
              TRY AGAIN
            </button>
          </div>
        )}

        {/* Close button — allowed everywhere except mid-ad */}
        {phase !== 'playing' && phase !== 'success' && (
          <button
            onClick={onClose}
            className="absolute top-2.5 right-2.5 p-1.5 rounded-full bg-black/40 hover:bg-black/60 text-white/70"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </motion.div>
    </motion.div>
  )
}

// Re-exported for existing call sites (GameStoreTabs onRewarded typing).
export type { Reward as RewardedAdReward }
