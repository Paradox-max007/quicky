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
 * ⚡ Gift multiplier header (PRD §14/§15/§72): "3× TIME — Send gifts and
 * earn more points — 01:42:18", driven by the realm store's live snapshot
 * and counting down from the SERVER expiresAt (client ticks are cosmetic).
 */
export function GiftMultiplierHeader({ compact }: { compact?: boolean }) {
  const multiplier = useRealmStore((s) => s.multiplier)
  const now = useNow(1000)
  if (multiplier.multiplier <= 1 || !multiplier.expiresAt) return null

  const remaining = Math.max(0, new Date(multiplier.expiresAt).getTime() - now)
  const totalSec = Math.floor(remaining / 1000)
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0')
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')

  return (
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
  )
}

/**
 * Per-gift point preview (PRD §73): "You +3 · Them +3" (self: "+6") for the
 * currently selected quantity, using the live multiplier.
 */
export function GiftPointPreview({ quantity, isSelf }: { quantity: number; isSelf: boolean }) {
  const multiplier = useRealmStore((s) => s.multiplier.multiplier) || 1
  const each = quantity * multiplier
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
