'use client'

// Quicky — REALM LEADERBOARD SCREEN
//
// Opened from the Games hub TROPHY badge (heart = lifetime points pair):
//   · mobile web + Capacitor → a DEDICATED FULL SCREEN
//   · desktop web            → a DRAWER FROM THE LEFT (below the 56px topbar)
//
// Content:
//   · the player's CURRENT realm + cycle countdown + the minimum points to
//     qualify for the NEXT realm (threshold)
//   · the promotion visual: CURRENT REALM ──→ NEXT REALM with the first 3
//     positions (cohort of max 8) each carrying an arrow "advances" mark
//   · places 4-8: the "try hard next time" zone with the admin-configured
//     consolation coin gifts (4th=50 … 8th=5 by default)
//   · a rewarded-ad CTA (coins OR points, random 1-1000)

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ArrowLeft, ArrowRight, Trophy, Crown, Play, TrendingUp } from 'lucide-react'
import { useRealmStore } from '@/store/realm'
import { useIsDesktopShell } from '@/hooks/useIsDesktopShell'
import { formatCompact } from '@/lib/quicky/format'
import { RealmCycleTimer } from './RealmProgress'
import { RewardedAdModal } from '../RewardedAdModal'

const MEDALS = ['🥇', '🥈', '🥉']

export function RealmLeaderboardScreen() {
  const open = useRealmStore((s) => s.leaderboardOpen)
  const close = useRealmStore((s) => s.closeLeaderboard)
  const snapshot = useRealmStore((s) => s.snapshot)
  const refresh = useRealmStore((s) => s.refresh)
  const isDesk = useIsDesktopShell() === true
  const [adOpen, setAdOpen] = useState(false)

  const rows = snapshot?.leaderboard ?? []
  const top3 = rows.filter((r) => r.rank <= 3)
  const rest = rows.filter((r) => r.rank > 3)
  const nextRealmName = snapshot?.nextRealm?.name ?? null
  const threshold = snapshot?.threshold ?? 0

  const body = (
    <div className="flex flex-col min-h-0 flex-1 overflow-y-auto px-4 pb-5 gap-4 no-scrollbar">
      {/* ── Current realm + qualification ─────────────────────────────── */}
      {snapshot ? (
        <>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4" data-testid="realm-lb-current">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-[var(--qk-gold)]/15 border border-[var(--qk-gold)]/25 flex items-center justify-center shrink-0">
                <Crown className="w-5 h-5 text-[var(--qk-gold)]" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Your realm</p>
                <p className="text-[15px] font-bold truncate">{snapshot.realm.name}</p>
              </div>
              {snapshot.cycle && (
                <span className="shrink-0 text-[10.5px] font-bold tabular-nums text-[var(--qk-gold)]">
                  <RealmCycleTimer endsAt={snapshot.cycle.endsAt} /> left
                </span>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-2xl bg-[var(--qk-gold)]/8 border border-[var(--qk-gold)]/15 px-3 py-2">
              <TrendingUp className="w-3.5 h-3.5 text-[var(--qk-gold)] shrink-0" aria-hidden />
              <p className="text-[11.5px] font-semibold leading-snug">
                Finish in the <b>Top 3</b> with at least{' '}
                <b className="text-[var(--qk-gold)] tabular-nums">{threshold.toLocaleString()} pts</b> to qualify for{' '}
                <b>{nextRealmName ?? 'the next realm'}</b>.
              </p>
            </div>
          </div>

          {/* ── Promotion visual: current ──→ next, top 3 with arrows ──── */}
          <div className="rounded-3xl border border-white/10 bg-[var(--qk-card)]/60 p-4" data-testid="realm-lb-promotion">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-3">Promotion zone</p>

            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 rounded-2xl bg-white/6 border border-white/10 px-3 py-2.5 text-center">
                <p className="text-[9px] font-black uppercase tracking-wider text-white/40">Current</p>
                <p className="text-[12.5px] font-bold truncate">{snapshot.realm.name}</p>
              </div>
              <motion.div
                animate={{ x: [0, 4, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                className="shrink-0 flex items-center text-[var(--qk-gold)]"
                aria-hidden
              >
                <ArrowRight className="w-5 h-5" strokeWidth={2.5} />
              </motion.div>
              <div
                className="flex-1 min-w-0 rounded-2xl px-3 py-2.5 text-center border"
                style={{ background: 'color-mix(in srgb, var(--qk-gold) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--qk-gold) 30%, transparent)' }}
              >
                <p className="text-[9px] font-black uppercase tracking-wider" style={{ color: 'var(--qk-gold)' }}>
                  Next
                </p>
                <p className="text-[12.5px] font-bold truncate">{nextRealmName ?? 'Season rollover'}</p>
              </div>
            </div>

            {/* First 3 positions — passing to the next realm */}
            <div className="mt-3 flex flex-col gap-1.5">
              {top3.length === 0 && (
                <p className="text-center text-[11.5px] text-white/40 py-3">Your cohort is forming — send gifts to start climbing.</p>
              )}
              {top3.map((row) => (
                <div
                  key={row.userId}
                  className={`flex items-center gap-2.5 rounded-2xl px-3 py-2 border ${
                    row.isMe ? 'border-[color-mix(in_srgb,var(--qk-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--qk-accent)_10%,transparent)]' : 'border-white/8 bg-white/4'
                  }`}
                >
                  <span className="text-[15px] shrink-0" aria-hidden>{MEDALS[row.rank - 1]}</span>
                  {row.avatar ? (
                    <img src={row.avatar} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                  ) : (
                    <span className="w-7 h-7 rounded-full bg-white/10 shrink-0" aria-hidden />
                  )}
                  <p className="flex-1 min-w-0 truncate text-[12.5px] font-bold">
                    {row.name}
                    {row.isMe && <span className="ml-1.5 text-[9px] font-black uppercase tracking-wider" style={{ color: 'var(--qk-accent)' }}>You</span>}
                  </p>
                  <span className="text-[12px] font-black tabular-nums shrink-0">{formatCompact(row.cyclePoints)}</span>
                  {row.cyclePoints >= threshold ? (
                    <span
                      className="shrink-0 flex items-center gap-1 text-[9.5px] font-black uppercase tracking-wide rounded-full px-1.5 py-0.5"
                      style={{ background: 'color-mix(in srgb, var(--qk-gold) 22%, transparent)', color: 'var(--qk-gold)' }}
                      title={`Advances to ${nextRealmName ?? 'the next realm'} if the cycle ended now`}
                    >
                      <ArrowRight className="w-3 h-3" strokeWidth={3} aria-hidden />
                      {nextRealmName ?? 'Next'}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[9.5px] font-bold text-white/40 tabular-nums">
                      {(threshold - row.cyclePoints).toLocaleString()} to go
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Places 4-8: try-hard zone with consolation coins ──────── */}
          {rest.length > 0 && (
            <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-4" data-testid="realm-lb-rest">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35 mb-3">Try hard next time</p>
              <div className="flex flex-col gap-1.5">
                {rest.map((row) => {
                  const coins = snapshot.consolationCoins?.[String(row.rank) as '4' | '5' | '6' | '7' | '8'] ?? 0
                  return (
                    <div
                      key={row.userId}
                      className={`flex items-center gap-2.5 rounded-2xl px-3 py-2 border ${
                        row.isMe ? 'border-[color-mix(in_srgb,var(--qk-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--qk-accent)_10%,transparent)]' : 'border-white/6 bg-white/[0.02]'
                      }`}
                    >
                      <span className="w-6 text-center text-[11px] font-black text-white/35 tabular-nums shrink-0">{row.rank}</span>
                      {row.avatar ? (
                        <img src={row.avatar} alt="" className="w-7 h-7 rounded-full object-cover shrink-0 grayscale-[35%]" />
                      ) : (
                        <span className="w-7 h-7 rounded-full bg-white/10 shrink-0" aria-hidden />
                      )}
                      <p className="flex-1 min-w-0 truncate text-[12.5px] font-bold text-white/70">
                        {row.name}
                        {row.isMe && <span className="ml-1.5 text-[9px] font-black uppercase tracking-wider" style={{ color: 'var(--qk-accent)' }}>You</span>}
                      </p>
                      <span className="text-[12px] font-black tabular-nums text-white/50 shrink-0">{formatCompact(row.cyclePoints)}</span>
                      {coins > 0 && (
                        <span
                          className="shrink-0 text-[9.5px] font-black tabular-nums rounded-full px-1.5 py-0.5"
                          style={{ background: 'color-mix(in srgb, #FFC53D 14%, transparent)', color: '#FFC53D' }}
                          title="Consolation coin gift for this place at settlement (admin-configured)"
                        >
                          +{coins} 🪙
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] text-white/30 mt-2.5 leading-relaxed">
                Places 4-8 stay in {snapshot.realm.name} for the next cycle — with a small consolation coin gift.
              </p>
            </div>
          )}

          {/* ── My standing summary ───────────────────────────────────── */}
          {snapshot.rank != null && (
            <div className="flex items-center justify-center gap-4 text-center">
              <div>
                <p className="text-[9px] font-black uppercase tracking-wider text-white/35">My rank</p>
                <p className="text-[15px] font-black tabular-nums">#{snapshot.rank}</p>
              </div>
              <div className="w-px h-8 bg-white/10" aria-hidden />
              <div>
                <p className="text-[9px] font-black uppercase tracking-wider text-white/35">Cycle pts</p>
                <p className="text-[15px] font-black tabular-nums" style={{ color: 'var(--qk-gold)' }}>{snapshot.points.toLocaleString()}</p>
              </div>
              <div className="w-px h-8 bg-white/10" aria-hidden />
              <div>
                <p className="text-[9px] font-black uppercase tracking-wider text-white/35">Cohort</p>
                <p className="text-[15px] font-black tabular-nums">{snapshot.cohortSize}/8</p>
              </div>
            </div>
          )}

          {/* ── Rewarded ad CTA ───────────────────────────────────────── */}
          <button
            onClick={() => setAdOpen(true)}
            className="w-full flex items-center justify-center gap-2 rounded-2xl border border-[var(--qk-accent)]/30 bg-[var(--qk-accent)]/10 px-4 py-3 text-sm font-bold text-[var(--qk-accent)] hover:bg-[var(--qk-accent)]/18 transition-colors active:scale-[0.98]"
            data-testid="realm-lb-watch-ad"
          >
            <Play className="w-4 h-4" fill="currentColor" aria-hidden />
            Watch an ad — earn coins or points
          </button>
        </>
      ) : (
        <div className="flex justify-center py-14">
          <div className="w-9 h-9 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
        </div>
      )}
    </div>
  )

  const header = (
    <div className={`shrink-0 flex items-center gap-2 px-4 py-3 border-b border-white/8 ${isDesk ? '' : 'app-safe-top'}`}>
      <button
        onClick={close}
        className="p-2 -ml-1 rounded-full hover:bg-white/8 active:scale-95 transition"
        aria-label="Close realm leaderboard"
        data-testid="realm-lb-close"
      >
        {isDesk ? <X className="w-5 h-5" /> : <ArrowLeft className="w-5 h-5" />}
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
          <Trophy className="w-4.5 h-4.5 text-[var(--qk-gold)]" aria-hidden />
          Realm Leaderboard
        </h1>
        <p className="text-[11px] text-white/40">
          8-player cohorts · Top 3 + threshold promote
        </p>
      </div>
      <button
        onClick={() => void refresh()}
        className="p-2 rounded-full hover:bg-white/8 text-white/60 transition"
        aria-label="Refresh standings"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M21 12a9 9 0 1 1-2.64-6.36" strokeLinecap="round" />
          <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )

  const adModal = <RewardedAdModal open={adOpen} onClose={() => setAdOpen(false)} />

  return (
    <AnimatePresence>
      {open && (
        <>
          {isDesk ? (
            // ── DESKTOP: drawer from the left, below the top nav ────────
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[198] bg-black/55 backdrop-blur-[2px]"
                onClick={close}
                data-testid="realm-lb-backdrop"
              />
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', stiffness: 340, damping: 34 }}
                className="fixed left-0 top-[var(--qk-nav-h,0px)] bottom-0 w-[430px] max-w-[80%] z-[199] bg-[var(--qk-bg)] border-r border-white/10 shadow-2xl flex flex-col text-white"
                data-testid="realm-lb-drawer"
                role="dialog"
                aria-label="Realm leaderboard"
              >
                {header}
                {body}
              </motion.div>
            </>
          ) : (
            // ── MOBILE / CAPACITOR: dedicated full screen ───────────────
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[198] bg-[var(--qk-bg)] text-white flex flex-col"
              data-testid="realm-lb-screen"
              role="dialog"
              aria-label="Realm leaderboard"
            >
              {header}
              {body}
            </motion.div>
          )}
          {adModal}
        </>
      )}
    </AnimatePresence>
  )
}
