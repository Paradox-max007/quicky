'use client'

// Quicky — REALM PROGRESS + CYCLE TIMER + MULTIPLIER HEADER (realm PRD §42/§15/§79/§72)
//
// Reusable, theme-token pieces shared by BOTH room games, the Realm details
// sheet and the gift panels. No game-specific HUD — one common Realm system
// (PRD §41/§70).

import { useEffect, useState } from 'react'
import { useRealmStore } from '@/store/realm'

export function formatCycleCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return '0m'
  const totalMin = Math.floor(msRemaining / 60000)
  if (msRemaining < 60 * 60 * 1000) {
    const s = Math.floor((msRemaining % 60000) / 1000)
    const m = Math.floor(totalMin)
    return `${m}m ${String(s).padStart(2, '0')}s`
  }
  if (msRemaining < 24 * 60 * 60 * 1000) {
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60
    return `${h}h ${m}m`
  }
  const d = Math.floor(totalMin / (24 * 60))
  const h = Math.floor((totalMin % (24 * 60)) / 60)
  const m = totalMin % 60
  return `${d}d ${h}h ${m}m`
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** ⏱ Realm cycle countdown (PRD §79): "2d 14h 32m" → "23h 51m" → "58m 12s". */
export function RealmCycleTimer({ endsAt, className }: { endsAt: string; className?: string }) {
  const now = useNow(1000)
  const remaining = new Date(endsAt).getTime() - now
  return <span className={className} suppressHydrationWarning>{formatCycleCountdown(remaining)}</span>
}

/**
 * Realm progress block (PRD §42): realm name, points/threshold, themed
 * progress bar and the "N points to Next" line — with the
 * threshold-reached hint (top-3 still required, §31).
 */
export function RealmProgress({
  level,
  name,
  points,
  threshold,
  nextRealmName,
  compact,
}: {
  level: number
  name: string
  points: number
  threshold: number
  nextRealmName: string | null
  compact?: boolean
}) {
  const pct = threshold > 0 ? Math.min(100, Math.round((points / threshold) * 100)) : 100
  const reached = threshold > 0 && points >= threshold

  return (
    <div className="w-full" data-testid="realm-progress">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-black tracking-wide text-[13px] uppercase">
          <span aria-hidden>👑</span> {name}
          {!compact && <span className="ml-1.5 text-[10px] font-bold opacity-60">Lv {level}</span>}
        </p>
        <p className="text-[11px] font-bold tabular-nums opacity-80">
          {points.toLocaleString()} / {threshold > 0 ? threshold.toLocaleString() : 'MAX'}
        </p>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.max(pct, 2)}%`, background: 'linear-gradient(90deg, var(--qk-accent), var(--qk-accent-light))' }}
        />
      </div>
      <p className="mt-1.5 text-[11px] font-semibold opacity-70">
        {level >= 15 ? (
          <>Maximum Realm — The Apex. Keep competing for top-3 rewards.</>
        ) : reached ? (
          <>Threshold reached — finish in the Top 3 of your cohort to advance.</>
        ) : (
          <>
            {(threshold - points).toLocaleString()} points to {nextRealmName ?? 'the next Realm'}
          </>
        )}
      </p>
    </div>
  )
}

/**
 * 🔥 Final-hours boost badge (Game Economy PRD §24/§26): "🔥 2× REALM
 * BOOST — 03:42:18". Server-resolved (realm store), client ticks are
 * cosmetic only. Renders nothing while inactive.
 */
export function RealmBoostBadge({ compact }: { compact?: boolean }) {
  const boost = useRealmStore((s) => s.boost)
  const now = useNow(1000)
  if (!boost.active || boost.multiplier <= 1) return null

  const remaining = Math.max(0, new Date(boost.endsAt ?? 0).getTime() - now)
  const totalSec = Math.floor(remaining / 1000)
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0')
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')

  return (
    <div
      className={`flex items-center gap-2 rounded-xl px-3 ${compact ? 'py-1.5' : 'py-2'} border`}
      style={{
        background: 'color-mix(in srgb, var(--qk-accent) 18%, transparent)',
        borderColor: 'color-mix(in srgb, var(--qk-accent) 45%, transparent)',
      }}
      data-testid="realm-boost-badge"
    >
      <span className="text-[13px]" aria-hidden>🔥</span>
      <span className="font-black text-[12px]" style={{ color: 'var(--qk-accent)' }}>
        {boost.multiplier}× REALM BOOST
      </span>
      {!compact && <span className="text-[11px] font-semibold opacity-75">Gifts earn {boost.multiplier}× ❤️ points</span>}
      <span className="ml-auto text-[11px] font-black tabular-nums" style={{ color: 'var(--qk-accent)' }}>
        {remaining > 0 ? `${hh}:${mm}:${ss}` : 'ending…'}
      </span>
    </div>
  )
}

/**
 * ⏰ Cycle countdown phase chip (Game Economy PRD §19): the countdown
 * escalates as the cycle closes —
 *     boost active → "🔥 2× ACTIVE"
 *     ≤ 30 min     → "🔥 FINAL 30 MINUTES"
 *     ≤ 5 min      → "🔥 FINAL 5 MINUTES"
 *     ≤ 0          → "🏆 REALM COMPLETE"
 * Renders nothing in the calm mid-cycle window (the plain timer covers it).
 */
export function RealmCyclePhaseBadge({ endsAt }: { endsAt: string }) {
  const boost = useRealmStore((s) => s.boost)
  const now = useNow(1000)
  const remaining = new Date(endsAt).getTime() - now

  let label: string | null = null
  let bg = 'color-mix(in srgb, var(--qk-accent) 16%, transparent)'
  let border = 'color-mix(in srgb, var(--qk-accent) 40%, transparent)'
  let color = 'var(--qk-accent)'

  if (remaining <= 0) {
    label = '🏆 REALM COMPLETE'
    bg = 'color-mix(in srgb, var(--qk-gold) 16%, transparent)'
    border = 'color-mix(in srgb, var(--qk-gold) 40%, transparent)'
    color = 'var(--qk-gold)'
  } else if (remaining <= 5 * 60 * 1000) {
    label = '🔥 FINAL 5 MINUTES'
  } else if (remaining <= 30 * 60 * 1000) {
    label = '🔥 FINAL 30 MINUTES'
  } else if (boost.active && boost.multiplier > 1) {
    label = `🔥 ${boost.multiplier}× ACTIVE`
  }
  if (!label) return null

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 border whitespace-nowrap"
      style={{ background: bg, borderColor: border }}
      data-testid="realm-cycle-phase"
    >
      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color }}>
        {label}
      </span>
    </span>
  )
}

/**
 * ⚡ Gift multiplier header (PRD §14/§15/§72): "3× TIME — Send gifts and
 * earn more points — 01:42:18", driven by the realm store's live snapshot
 * and counting down from the SERVER expiresAt (client ticks are cosmetic).
 * The final-hours boost badge rides along (Game Economy PRD §25) so the
 * user sees the TOTAL rate before spending.
 */
export function GiftMultiplierHeader({ compact }: { compact?: boolean }) {
  const multiplier = useRealmStore((s) => s.multiplier)
  const boost = useRealmStore((s) => s.boost)
  const now = useNow(1000)
  if (multiplier.multiplier <= 1 || !multiplier.expiresAt) return <RealmBoostBadge compact={compact} />

  const remaining = Math.max(0, new Date(multiplier.expiresAt).getTime() - now)
  const totalSec = Math.floor(remaining / 1000)
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0')
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`flex items-center gap-2 rounded-xl px-3 ${compact ? 'py-1.5' : 'py-2'} border`}
        style={{
          background: 'color-mix(in srgb, var(--qk-accent) 14%, transparent)',
          borderColor: 'color-mix(in srgb, var(--qk-accent) 35%, transparent)',
        }}
        data-testid="gift-multiplier-header"
      >
        <span className="text-[13px]" aria-hidden>⚡</span>
        <span className="font-black text-[12px] tabular-nums" style={{ color: 'var(--qk-accent)' }}>
          {multiplier.multiplier}× TIME
        </span>
        {!compact && <span className="text-[11px] font-semibold opacity-75">Send gifts and earn more points</span>}
        <span className="ml-auto text-[11px] font-black tabular-nums" style={{ color: 'var(--qk-accent)' }}>
          {remaining > 0 ? `${hh}:${mm}:${ss}` : 'ending…'}
        </span>
      </div>
      {boost.active && boost.multiplier > 1 && <RealmBoostBadge compact={compact} />}
    </div>
  )
}

/**
 * Per-gift point preview (PRD §73): "You +3 · Them +3" (self: "+6") for the
 * currently selected quantity, using the live multiplier.
 */
export function GiftPointPreview({ quantity, isSelf }: { quantity: number; isSelf: boolean }) {
  const multiplier = useRealmStore((s) => s.multiplier.multiplier) || 1
  const boostMultiplier = useRealmStore((s) => (s.boost.active ? s.boost.multiplier : 1)) || 1
  const effective = multiplier * boostMultiplier
  const each = quantity * effective
  const self = each * 2
  return (
    <p className="text-[11px] font-bold opacity-80" data-testid="gift-point-preview">
      {isSelf ? (
        <>You +<span style={{ color: 'var(--qk-accent)' }}>{self}</span> points</>
      ) : (
        <>
          You +<span style={{ color: 'var(--qk-accent)' }}>{each}</span> · Them +<span style={{ color: 'var(--qk-accent)' }}>{each}</span> points
        </>
      )}
    </p>
  )
}
