'use client'

// Quicky — CRATE ROOM (crate-tracks PRD — screen 2, the battle pass)
//
// Opened by "Get Crate" on the Realm Pass. BATTLE-PASS LAYOUT:
//   · FREE prize row  (top)    — collectible by WINNING REALMS alone
//   · THE PROGRESS BAR (middle separator) — crate points fill it between
//     level thresholds; the level nodes (numbers) sit ON the bar
//   · CRATE prize row (bottom) — locked until the pack is bought ("Get
//     Crate"), then realm wins collect BOTH rows' reached prizes
// Prizes are aligned in columns: every level is one fixed-width column with
// its free tile / node / crate tile stacked — the rows never drift apart.
// The strip scrolls sideways and auto-centers on the current level.
//
// Progress source: crate points earned per realm PLACEMENT (1st-8th, each
// realm's admin-configured amounts). Thresholds + both prizes per level are
// admin-configured (100 levels for now).
//
// Presentation mirrors screen 1: a dedicated sliding screen on mobile
// web/Capacitor (pushes over the pass screen — stacked navigation), and the
// centered modal's content on desktop web.

import { useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ArrowLeft, Lock, Check, Sparkles, Coins, Star } from 'lucide-react'
import { toast } from 'sonner'
import { usePassStore, type CrateLevelRowClient, type CratePackRowClient } from '@/store/pass'
import { useIsDesktopShell } from '@/hooks/useIsDesktopShell'
import { formatCompact } from '@/lib/quicky/format'

// Track geometry (px) — one column per level, aligned rows.
const COL_W = 76
const TILE_H = 72
const NODE_ROW_H = 58
const BAR_TOP = TILE_H + NODE_ROW_H / 2 - 3 // circle center − half the 6px bar
const MILESTONES = [10, 25, 50, 100] as const

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** MOBILE: the full-screen layer that slides OVER the Realm Pass screen. */
export function CrateDetailsScreen() {
  const crateId = usePassStore((s) => s.crateId)

  return (
    <AnimatePresence>
      {crateId && (
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          className="fixed inset-0 z-[206] bg-[var(--qk-bg)] text-white flex flex-col"
          role="dialog"
          aria-label="Crate room"
          data-testid="crate-details-screen"
        >
          <CrateDetailsContent />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The shared content (mobile screen 2 / desktop modal body). */
export function CrateDetailsContent() {
  const isDesk = useIsDesktopShell() === true
  const crateId = usePassStore((s) => s.crateId)
  const detail = usePassStore((s) => s.detail)
  const detailLoading = usePassStore((s) => s.detailLoading)
  const season = usePassStore((s) => s.season)
  const busy = usePassStore((s) => s.busy)
  const backToStore = usePassStore((s) => s.backToStore)
  const closePass = usePassStore((s) => s.closePass)
  const purchaseCrate = usePassStore((s) => s.purchaseCrate)
  const buyLevels = usePassStore((s) => s.buyLevels)
  const trackRef = useRef<HTMLDivElement>(null)

  const crate = detail?.crate ?? null
  const levels = useMemo(() => detail?.levels ?? [], [detail])

  // ── Level math (thresholds are cumulative crate points) ──────────────────
  const cur = crate?.currentLevel ?? 0
  const pts = crate?.cratePoints ?? 0
  const levelCount = crate?.levelCount ?? 0
  const thresholdOf = (level: number): number => {
    if (level <= 0) return 0
    const row = levels.find((lv) => lv.level === level)
    return row ? Math.max(0, row.thresholdPoints) : level * 20
  }
  const nextLevel = cur + 1
  const nextThreshold = nextLevel <= levelCount ? thresholdOf(nextLevel) : null
  // Fraction of the CURRENT segment (between node `cur` and node `cur+1`).
  const segT =
    nextThreshold === null
      ? 1
      : clamp01((pts - (cur > 0 ? thresholdOf(cur) : 0)) / Math.max(1, nextThreshold - (cur > 0 ? thresholdOf(cur) : 0)))
  // Pixel position of the progress fill edge along the track.
  const fillPos =
    nextThreshold === null
      ? Math.max(levels.length, 1) * COL_W
      : cur === 0
        ? segT * (COL_W / 2)
        : (cur - 0.5) * COL_W + segT * COL_W

  // Auto-center the track on the current level whenever the detail loads.
  useEffect(() => {
    if (!detail || !crate || levels.length === 0) return
    const el = trackRef.current
    if (!el) return
    const nodeCenter = (Math.min(cur + 1, levels.length) - 0.5) * COL_W
    el.scrollLeft = Math.max(0, nodeCenter - el.clientWidth / 2)
  }, [detail])

  const onUnlock = async () => {
    if (!crate || busy) return
    const res = await purchaseCrate(crate.id)
    if (res.ok) {
      toast.success('Crate pack unlocked!', { description: 'Every reached level\u2019s crate prizes just popped.' })
    } else if (res.error === 'insufficient_coins') {
      toast.error('Not enough coins', { description: 'Win more games or grab coins from the store.' })
    } else if (res.error !== 'already_unlocked') {
      toast.error('Could not get the crate — try again.')
    }
  }

  const onBuyPack = async (pack: CratePackRowClient) => {
    if (!crate || busy || !pack.affordable) return
    const res = await buyLevels(crate.id, pack.levels)
    if (res.ok) {
      toast.success(`+${pack.levels} level${pack.levels > 1 ? 's' : ''} unlocked!`)
    } else if (res.error === 'insufficient_coins') {
      toast.error('Not enough coins')
    } else {
      toast.error('Could not buy levels — try again.')
    }
  }

  const tapTile = (lv: CrateLevelRowClient, track: 'free' | 'crate') => {
    const prize = track === 'free' ? { name: lv.freePrizeName ?? 'Free prize', qty: lv.freeQuantity } : { name: lv.prizeName ?? 'Prize', qty: lv.quantity }
    const state = track === 'free' ? (lv.reached ? 'collected' : `needs ${formatCompact(lv.thresholdPoints)} pts`) : !crate?.unlocked ? 'locked — get the crate pack' : lv.reached ? 'collected' : `needs ${formatCompact(lv.thresholdPoints)} pts`
    toast(`${prize.name}${prize.qty > 1 ? ` ×${prize.qty}` : ''}`, {
      description: `Level ${lv.level} · ${track === 'free' ? 'FREE' : 'CRATE'} track · ${state}`,
    })
  }

  if (!crateId) return null

  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className={`shrink-0 flex items-center gap-2 px-4 py-3 border-b border-white/8 ${isDesk ? '' : 'app-safe-top'}`}>
        <button
          onClick={backToStore}
          className="p-2 -ml-1 rounded-full hover:bg-white/8 active:scale-95 transition"
          aria-label="Back to the crate store"
          data-testid="crate-back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold tracking-tight truncate">{crate?.name ?? 'Crate'}</h1>
          <p className="text-[11px] text-white/40 truncate">
            {season?.season?.name ? `${season.season.name} · ` : ''}{formatCompact(levelCount)} levels · free + crate prizes
          </p>
        </div>
        <button
          onClick={closePass}
          className="p-2 rounded-full hover:bg-white/8 transition"
          aria-label="Close realm pass"
          data-testid="crate-close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {!detail && detailLoading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
        </div>
      )}

      {detail && crate && (
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto no-scrollbar px-4 py-3 gap-3">
          {/* ── Hero: crate identity + level/points readout ─────────────── */}
          <div className="shrink-0 rounded-2xl border border-white/10 bg-white/5 p-3 flex items-center gap-3" data-testid="crate-progress">
            {crate.imageUrl ? (
              <img src={crate.imageUrl} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0 border border-white/10" />
            ) : (
              <span className="w-12 h-12 rounded-xl bg-[var(--qk-gold)]/12 border border-[var(--qk-gold)]/25 flex items-center justify-center text-[22px] shrink-0" aria-hidden>
                🎁
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[13px] font-bold truncate">
                  Level <b className="tabular-nums text-[15px]">{crate.currentLevel}</b>
                  <span className="text-white/40 text-[11px]"> / {formatCompact(crate.levelCount)}</span>
                </p>
                <span className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-[var(--qk-gold)] tabular-nums" title="Crate points — won by realm placements">
                  <Sparkles className="w-3.5 h-3.5" aria-hidden />
                  {formatCompact(crate.cratePoints)} pts
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-white/8 overflow-hidden" role="progressbar">
                <div
                  className="h-full rounded-full bg-[var(--qk-gold)]"
                  style={{ width: `${(crate.currentLevel / Math.max(1, crate.levelCount)) * 100}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] font-semibold text-white/45 tabular-nums">
                {nextThreshold !== null
                  ? `${formatCompact(Math.max(0, nextThreshold - crate.cratePoints))} pts to Level ${nextLevel} · win realms (1st-8th earn points)`
                  : 'Track complete — every prize collected 🎉'}
              </p>
            </div>
          </div>

          {/* ── Legend: which row is which ───────────────────────────────── */}
          <div className="shrink-0 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[9.5px] font-black uppercase tracking-[0.14em] text-[#30D158]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#30D158]" aria-hidden />
              Free prizes ↑
            </span>
            <span className="flex items-center gap-1.5 text-[9.5px] font-black uppercase tracking-[0.14em] text-[var(--qk-gold)]">
              {crate.unlocked ? 'Crate prizes ↓ unlocked' : 'Crate prizes ↓ locked 🔒'}
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--qk-gold)]" aria-hidden />
            </span>
          </div>

          {/* ── THE TRACK — progress bar is the middle separator ─────────── */}
          <div
            className="shrink-0 rounded-2xl border border-white/10 bg-black/25 py-2.5 overflow-x-auto no-scrollbar"
            data-testid="crate-levels"
          >
            {levels.length === 0 ? (
              <p className="text-center text-[11.5px] text-white/40 py-6 px-4">This crate has no levels configured yet.</p>
            ) : (
              <div className="relative w-max min-w-full">
                {/* The continuous separator bar (progress = crate points) */}
                <div className="absolute left-0 right-0 h-[6px] rounded-full bg-white/10 overflow-hidden" style={{ top: BAR_TOP }} aria-hidden>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(0, fillPos)}px`,
                      background: 'linear-gradient(90deg, color-mix(in srgb, var(--qk-gold) 55%, transparent), var(--qk-gold))',
                    }}
                  />
                </div>
                {/* The moving position marker on the bar */}
                <div
                  className="absolute w-[10px] h-[10px] rounded-full border-2 border-[var(--qk-bg)]"
                  style={{
                    top: BAR_TOP - 2,
                    left: `${Math.max(0, fillPos) - 5}px`,
                    background: 'var(--qk-gold)',
                    boxShadow: '0 0 8px color-mix(in srgb, var(--qk-gold) 80%, transparent)',
                  }}
                  aria-hidden
                />
                {/* The aligned level columns */}
                <div className="flex">
                  {levels.map((lv) => (
                    <div key={lv.level} className="shrink-0 flex flex-col" style={{ width: COL_W }} data-testid={`crate-level-${lv.level}`}>
                      <FreeTile level={lv} onTap={() => tapTile(lv, 'free')} />
                      <NodeCell
                        level={lv.level}
                        threshold={lv.thresholdPoints}
                        reached={lv.reached}
                        current={lv.level === cur}
                        milestone={MILESTONES.includes(lv.level as (typeof MILESTONES)[number])}
                      />
                      <CrateTile level={lv} locked={!crate.unlocked} onTap={() => tapTile(lv, 'crate')} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── CTA: get the pack (locked) / level packs (unlocked) ──────── */}
          {!crate.unlocked ? (
            <div className="shrink-0 rounded-2xl border border-[var(--qk-gold)]/30 bg-[var(--qk-gold)]/8 p-3.5" data-testid="crate-locked">
              <p className="text-[11.5px] font-semibold text-white/70 leading-relaxed">
                Winning realms already collects the <b className="text-[#30D158]">free prizes</b> above.
                <b className="text-[var(--qk-gold)]"> Get the crate pack</b> to also unlock every gold-row prize your progress reaches.
              </p>
              <button
                onClick={() => void onUnlock()}
                disabled={busy}
                className="mt-3 w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[14px] font-black active:scale-[0.98] transition-transform border disabled:opacity-60"
                style={{
                  background: 'color-mix(in srgb, var(--qk-gold) 22%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--qk-gold) 50%, transparent)',
                  color: 'var(--qk-gold)',
                }}
                data-testid="crate-unlock"
              >
                <Lock className="w-4.5 h-4.5" aria-hidden />
                Get Crate Pack · {crate.priceCoins.toLocaleString()} coins
              </button>
            </div>
          ) : (
            (detail.packs?.length ?? 0) > 0 && (
              <div className="shrink-0" data-testid="crate-packs">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-2">Crate packs — jump levels with coins</p>
                <div className="grid grid-cols-4 gap-2">
                  {detail.packs.map((pack) => (
                    <button
                      key={pack.levels}
                      onClick={() => void onBuyPack(pack)}
                      disabled={busy || !pack.affordable}
                      className={`rounded-2xl border p-2.5 text-left transition-colors ${
                        pack.affordable ? 'border-white/10 bg-white/[0.04] hover:bg-white/8 active:scale-[0.98]' : 'border-white/6 bg-white/[0.02] opacity-55'
                      }`}
                      data-testid={`crate-pack-${pack.levels}`}
                    >
                      <p className="text-[12.5px] font-black tabular-nums">+{pack.levels}</p>
                      <p className="text-[9.5px] text-white/45 mt-0.5">{pack.levels === 1 ? 'level' : 'levels'}</p>
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-black tabular-nums" style={{ color: 'var(--qk-gold)' }}>
                        <Coins className="w-3 h-3" aria-hidden />
                        {formatCompact(pack.priceCoins)}
                      </p>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[10px] font-semibold text-white/40 leading-relaxed">
                  Win realms for crate points (1st place earns the most, down to 8th) — every level&apos;s threshold unlocks its prizes.
                </p>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

/** The level node (number circle) sitting ON the separator bar. */
function NodeCell({ level, threshold, reached, current, milestone }: { level: number; threshold: number; reached: boolean; current: boolean; milestone: boolean }) {
  return (
    <div className="relative flex flex-col items-center justify-center" style={{ height: NODE_ROW_H }}>
      <span
        className={`relative z-10 flex items-center justify-center rounded-full font-black tabular-nums transition-colors ${
          current ? 'text-black' : reached ? 'text-black' : 'text-white/55'
        }`}
        style={{
          width: milestone ? 38 : 34,
          height: milestone ? 38 : 34,
          fontSize: milestone ? 13 : 12,
          background: reached ? 'var(--qk-gold)' : current ? 'color-mix(in srgb, var(--qk-gold) 35%, transparent)' : 'rgba(255,255,255,0.10)',
          border: milestone || current ? '2px solid var(--qk-gold)' : '1px solid rgba(255,255,255,0.14)',
          boxShadow: current ? '0 0 12px color-mix(in srgb, var(--qk-gold) 65%, transparent)' : undefined,
        }}
        aria-label={`Level ${level}${reached ? ' — reached' : ''}`}
      >
        {level}
        {milestone && (
          <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-[var(--qk-gold)] text-black" aria-hidden>
            <Star className="w-2.5 h-2.5" strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="absolute bottom-0 left-0 right-0 text-center text-[9px] font-bold tabular-nums text-white/35" aria-hidden>
        {formatCompact(Math.max(0, threshold))}
      </span>
    </div>
  )
}

/** One FREE-track prize tile (top row — collectible by realm wins alone). */
function FreeTile({ level, onTap }: { level: CrateLevelRowClient; onTap: () => void }) {
  const collected = level.reached
  return (
    <button
      onClick={onTap}
      className={`relative mx-1 mb-1 rounded-xl border flex flex-col items-center justify-center transition-colors ${
        collected ? 'border-[#30D158]/40 bg-[#30D158]/10' : 'border-white/10 bg-white/[0.03]'
      }`}
      style={{ height: TILE_H, opacity: collected ? 1 : 0.62 }}
      aria-label={`Level ${level.level} free prize: ${level.freePrizeName ?? 'prize'}${level.freeQuantity > 1 ? ` ×${level.freeQuantity}` : ''}`}
    >
      <span className="text-[22px] leading-none" aria-hidden>{level.freePrizeEmoji ?? '🎁'}</span>
      <span className="mt-1 px-1 w-full text-[8.5px] font-bold text-white/70 leading-tight text-center truncate">{level.freePrizeName ?? 'Prize'}</span>
      {level.freeQuantity > 1 && (
        <span className="absolute top-1 right-1 text-[8px] font-black tabular-nums rounded-full px-1 py-px bg-black/45 text-white/80">×{level.freeQuantity}</span>
      )}
      {collected && (
        <span className="absolute top-1 left-1 flex items-center justify-center w-4 h-4 rounded-full bg-[#30D158] text-black" aria-label="collected">
          <Check className="w-2.5 h-2.5" strokeWidth={3.5} />
        </span>
      )}
    </button>
  )
}

/** One CRATE-track prize tile (bottom row — needs the pack bought). */
function CrateTile({ level, locked, onTap }: { level: CrateLevelRowClient; locked: boolean; onTap: () => void }) {
  const collected = level.reached && !locked
  return (
    <button
      onClick={onTap}
      className={`relative mx-1 mt-1 rounded-xl border flex flex-col items-center justify-center transition-colors ${
        collected ? 'border-[var(--qk-gold)]/45 bg-[var(--qk-gold)]/10' : 'border-white/10 bg-white/[0.03]'
      }`}
      style={{ height: TILE_H, opacity: collected ? 1 : locked ? 0.5 : 0.62 }}
      aria-label={`Level ${level.level} crate prize: ${level.prizeName ?? 'prize'}${level.quantity > 1 ? ` ×${level.quantity}` : ''}`}
    >
      <span className={`text-[22px] leading-none ${locked ? 'grayscale' : ''}`} aria-hidden>{level.prizeEmoji ?? '🎁'}</span>
      <span className="mt-1 px-1 w-full text-[8.5px] font-bold text-white/70 leading-tight text-center truncate">{level.prizeName ?? 'Prize'}</span>
      {level.quantity > 1 && (
        <span className="absolute top-1 right-1 text-[8px] font-black tabular-nums rounded-full px-1 py-px bg-black/45 text-white/80">×{level.quantity}</span>
      )}
      {collected && (
        <span className="absolute top-1 left-1 flex items-center justify-center w-4 h-4 rounded-full bg-[var(--qk-gold)] text-black" aria-label="collected">
          <Check className="w-2.5 h-2.5" strokeWidth={3.5} />
        </span>
      )}
      {locked && (
        <span className="absolute inset-0 rounded-xl bg-black/45 flex items-center justify-center" aria-label="locked — get the crate pack">
          <Lock className="w-5 h-5 text-[var(--qk-gold)]/90" aria-hidden />
        </span>
      )}
    </button>
  )
}
