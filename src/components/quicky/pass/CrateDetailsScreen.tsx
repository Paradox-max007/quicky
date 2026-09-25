'use client'

// Quicky — CRATE ROOM (crate-tracks PRD — screen 2, the battle pass)
//
// Opened by "Get Crate" on the Realm Pass / the Crates banner. Battle-pass
// layout with ONE COLUMN of BIG SQUARE prizes per track:
//   · FREE track  (top)    — claimable by WINNING REALMS alone
//   · THE PROGRESS BAR — the SEPARATOR BAR AT THE MIDDLE of the screen: the
//     crate-points fill runs between the current level node and the next
//   · MAIN PRIZES  — the milestone prizes (levels 10/25/50/100) shown
//     directly BELOW the progress bar
//   · CRATE track  (bottom) — locked until the pack is bought ("Get Crate")
//
// The pass starts AT LEVEL 1 the moment a user logs in (level 1's threshold
// counts as 0): the first FREE prize tile is immediately claimable. Tapping
// an unlocked tile opens the CLAIM MODAL — it flies out FROM the tile, shows
// the prize + a CLAIM button; claiming grants it (coins → balance, gifts →
// inventory). Locked prizes stay VISIBLE with a lock overlay — accessible
// only once unlocked.
//
// Progress source: crate points earned per realm PLACEMENT (1st-8th, each
// realm's admin-configured amounts) against admin-set cumulative per-level
// thresholds (100 levels for now).
//
// Presentation mirrors screen 1: a dedicated sliding screen on mobile
// web/Capacitor (pushes over the pass screen — stacked navigation), and the
// centered modal's content on desktop web.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ArrowLeft, Lock, Check, Sparkles, Coins, Star, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { usePassStore, type CrateLevelRowClient, type CratePackRowClient, type ClaimTargetClient } from '@/store/pass'
import { useIsDesktopShell } from '@/hooks/useIsDesktopShell'
import { formatCompact } from '@/lib/quicky/format'

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
  const openClaim = usePassStore((s) => s.openClaim)
  const closeClaim = usePassStore((s) => s.closeClaim)
  const claimTarget = usePassStore((s) => s.claimTarget)
  const freeListRef = useRef<HTMLDivElement>(null)
  const crateListRef = useRef<HTMLDivElement>(null)

  const crate = detail?.crate ?? null
  const levels = useMemo(() => detail?.levels ?? [], [detail])

  // ── Level math (thresholds are cumulative; level 1 = 0 → login state) ──
  const cur = crate?.currentLevel ?? 0
  const pts = crate?.cratePoints ?? 0
  const levelCount = crate?.levelCount ?? 0
  const thresholdOf = (level: number): number => {
    if (level <= 1) return 0
    const row = levels.find((lv) => lv.level === level)
    return row ? Math.max(0, row.thresholdPoints) : (level - 1) * 20
  }
  const nextLevel = cur + 1
  const nextThreshold = nextLevel <= levelCount ? thresholdOf(nextLevel) : null
  // Fraction of the CURRENT segment (between the current and next level).
  const segT =
    nextThreshold === null ? 1 : clamp01((pts - thresholdOf(cur)) / Math.max(1, nextThreshold - thresholdOf(cur)))

  const freeClaimableCount = levels.filter((lv) => lv.freeClaimable).length
  const mainLevels = useMemo(() => levels.filter((lv) => MILESTONES.includes(lv.level as (typeof MILESTONES)[number])), [levels])

  // Center both tracks on the current level when the crate opens and again
  // whenever the level advances (purchases / new points) — plain refreshes
  // (e.g. after a claim) never yank the user's scroll position.
  const lastScrollKey = useRef<string | null>(null)
  useEffect(() => {
    if (!detail || levels.length === 0) return
    const key = `${crateId}#${cur}`
    if (lastScrollKey.current === key) return
    lastScrollKey.current = key
    const scrollToLevel = (ref: HTMLDivElement | null, level: number) => {
      if (!ref) return
      const idx = Math.max(1, Math.min(level, ref.children.length)) - 1
      const child = ref.children[idx] as HTMLElement | undefined
      if (!child) return
      ref.scrollTop = Math.max(0, child.offsetTop - ref.clientHeight / 2 + child.offsetHeight / 2)
    }
    scrollToLevel(freeListRef.current, Math.max(1, cur))
    scrollToLevel(crateListRef.current, Math.max(1, cur))
  }, [detail, crateId, cur])

  const onUnlock = async () => {
    if (!crate || busy) return
    const res = await purchaseCrate(crate.id)
    if (res.ok) {
      toast.success('Crate pack unlocked!', { description: 'Every gold prize your progress reaches is now claimable below.' })
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
      toast.success(`+${pack.levels} level${pack.levels > 1 ? 's' : ''} unlocked!`, { description: 'Claim the new prizes on the track.' })
    } else if (res.error === 'insufficient_coins') {
      toast.error('Not enough coins')
    } else {
      toast.error('Could not buy levels — try again.')
    }
  }

  /** Tap a tile: claimable → the claim modal; anything else → honest info. */
  const onTileTap = (lv: CrateLevelRowClient, track: 'free' | 'crate', el: HTMLElement) => {
    const isFree = track === 'free'
    const claimable = isFree ? lv.freeClaimable : lv.crateClaimable
    if (claimable) {
      const r = el.getBoundingClientRect()
      openClaim({ lv, track, cx: r.left + r.width / 2, cy: r.top + r.height / 2 })
      return
    }
    const prizeName = isFree ? lv.freePrizeName ?? 'Free prize' : lv.prizeName ?? 'Prize'
    if (isFree) {
      if (lv.freeCollected) {
        toast(`Already claimed — ${prizeName}`, { description: `Level ${lv.level} · FREE track` })
        return
      }
      // No threshold numbers in popups — the tile itself carries the pts badge.
      toast(`Locked — reach level ${lv.level}`, { description: 'Win realms to earn crate points' })
      return
    }
    if (!crate?.unlocked) {
      toast(`Locked — get the crate pack`, { description: `Level ${lv.level} crate prize · ${prizeName}` })
      return
    }
    if (lv.crateCollected) {
      toast(`Already claimed — ${prizeName}`, { description: `Level ${lv.level} · CRATE track` })
      return
    }
    toast(`Locked — reach level ${lv.level}`, { description: 'Win realms to earn crate points' })
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
            {season?.season?.name ? `${season.season.name} · ` : ''}{formatCompact(levelCount)} levels · claim every prize you reach
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
        <div className="flex-1 min-h-0 flex flex-col px-3.5 py-3 gap-2 overflow-hidden">
          {/* ── FREE track — one column of big square prizes ─────────────── */}
          <section className="flex-[1.15] min-h-[104px] flex flex-col" aria-label="Free prizes">
            <div className="shrink-0 flex items-center justify-between gap-2 px-1 pb-1.5">
              <span className="flex items-center gap-1.5 text-[9.5px] font-black uppercase tracking-[0.14em] text-[#30D158]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#30D158]" aria-hidden />
                Free prizes ↑
              </span>
              {freeClaimableCount > 0 ? (
                <span
                  className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider animate-pulse"
                  style={{ background: 'color-mix(in srgb, #30D158 22%, transparent)', color: '#30D158' }}
                >
                  {freeClaimableCount} to claim
                </span>
              ) : (
                <span className="text-[9px] font-bold text-white/35 uppercase tracking-wider">win realms to unlock</span>
              )}
            </div>
            <div ref={freeListRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-1.5 pr-0.5" data-testid="crate-free-track">
              {levels.length === 0 ? (
                <p className="text-center text-[11.5px] text-white/40 py-6 px-4">This crate has no levels configured yet.</p>
              ) : (
                levels.map((lv) => <PrizeRow key={lv.level} lv={lv} track="free" locked={false} onTap={onTileTap} />)
              )}
            </div>
          </section>

          {/* ── THE SEPARATOR — the progress bar at the MIDDLE of the screen */}
          <div
            className="shrink-0 rounded-2xl border border-white/10 bg-black/25 px-3 py-2.5"
            data-testid="crate-progress"
            role="progressbar"
            aria-label={`Level ${cur} — ${pts} of ${nextThreshold ?? pts} crate points`}
          >
            <div className="flex items-center gap-2.5">
              {/* current level node */}
              <span
                className="shrink-0 flex items-center justify-center rounded-full font-black tabular-nums text-black w-[42px] h-[42px] text-[14px]"
                style={{
                  background: 'linear-gradient(180deg, color-mix(in srgb, var(--qk-gold) 88%, white), var(--qk-gold))',
                  boxShadow: '0 0 14px color-mix(in srgb, var(--qk-gold) 55%, transparent)',
                }}
                aria-label={`Current level ${cur}`}
              >
                {cur}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[9px] font-black uppercase tracking-[0.16em] text-[var(--qk-gold)]">Crate points</span>
                  <span className="text-[10.5px] font-black tabular-nums text-white/85">
                    {formatCompact(pts)}
                    {nextThreshold !== null ? <span className="text-white/40"> / {formatCompact(nextThreshold)}</span> : ' · MAX'}
                  </span>
                </div>
                <div className="mt-1 relative h-2.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${segT * 100}%`,
                      background: 'linear-gradient(90deg, color-mix(in srgb, var(--qk-gold) 50%, transparent), var(--qk-gold))',
                      boxShadow: '0 0 10px color-mix(in srgb, var(--qk-gold) 60%, transparent)',
                    }}
                  />
                </div>
                <p className="mt-1 text-[9.5px] font-semibold text-white/45 tabular-nums truncate">
                  {nextThreshold !== null
                    ? `${formatCompact(Math.max(0, nextThreshold - pts))} pts to level ${nextLevel} · 1st-8th in realms earn points`
                    : 'Track complete — every level claimed 🎉'}
                </p>
              </div>
              {/* next level node */}
              {nextThreshold !== null && (
                <span
                  className="shrink-0 flex items-center justify-center rounded-full w-[42px] h-[42px] text-[14px] font-black tabular-nums text-white/60 border border-white/15 bg-white/5"
                  aria-label={`Next level ${nextLevel} at ${nextThreshold} points`}
                >
                  {nextLevel}
                </span>
              )}
            </div>
          </div>

          {/* ── MAIN PRIZES — the milestone showcase BELOW the progress bar */}
          {mainLevels.length > 0 && (
            <section className="shrink-0" aria-label="Main prizes">
              <div className="flex items-center gap-1.5 px-1 pb-1.5">
                <Star className="w-3 h-3 text-[var(--qk-gold)]" fill="currentColor" aria-hidden />
                <span className="text-[9.5px] font-black uppercase tracking-[0.14em] text-[var(--qk-gold)]">Main prizes — levels 10 · 25 · 50 · 100</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {mainLevels.map((lv) => (
                  <MainPrizeTile key={lv.level} lv={lv} unlocked={crate.unlocked} onTap={onTileTap} />
                ))}
              </div>
            </section>
          )}

          {/* ── CRATE track — one column, locked until the pack is bought ── */}
          <section className="flex-1 min-h-[104px] flex flex-col" aria-label="Crate prizes">
            <div className="shrink-0 flex items-center justify-between gap-2 px-1 pb-1.5">
              <span className="flex items-center gap-1.5 text-[9.5px] font-black uppercase tracking-[0.14em] text-[var(--qk-gold)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--qk-gold)]" aria-hidden />
                Crate prizes ↓
              </span>
              <span className="text-[9px] font-bold uppercase tracking-wider text-white/35">
                {crate.unlocked ? 'unlocked — claim as you climb' : 'get the pack to claim'}
              </span>
            </div>
            <div ref={crateListRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-1.5 pr-0.5" data-testid="crate-crate-track">
              {levels.map((lv) => (
                <PrizeRow key={lv.level} lv={lv} track="crate" locked={!crate.unlocked} onTap={onTileTap} />
              ))}
            </div>
          </section>

          {/* ── CTA: get the pack (locked) / level packs (unlocked) ──────── */}
          {!crate.unlocked ? (
            <div className="shrink-0" data-testid="crate-locked">
              <button
                onClick={() => void onUnlock()}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[14px] font-black active:scale-[0.98] transition-transform border disabled:opacity-60"
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
                <div className="grid grid-cols-4 gap-2">
                  {detail.packs.map((pack) => (
                    <button
                      key={pack.levels}
                      onClick={() => void onBuyPack(pack)}
                      disabled={busy || !pack.affordable}
                      className={`rounded-2xl border py-2 flex flex-col items-center transition-colors ${
                        pack.affordable ? 'border-white/10 bg-white/[0.04] hover:bg-white/8 active:scale-[0.98]' : 'border-white/6 bg-white/[0.02] opacity-55'
                      }`}
                      data-testid={`crate-pack-${pack.levels}`}
                      aria-label={`Buy ${pack.levels} levels for ${pack.priceCoins} coins`}
                    >
                      <p className="text-[13px] font-black tabular-nums leading-none">+{pack.levels}</p>
                      <p className="text-[8.5px] text-white/45 mt-0.5 leading-none">{pack.levels === 1 ? 'level' : 'levels'}</p>
                      <p className="mt-1 flex items-center gap-0.5 text-[10.5px] font-black tabular-nums" style={{ color: 'var(--qk-gold)' }}>
                        <Coins className="w-3 h-3" aria-hidden />
                        {formatCompact(pack.priceCoins)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* ── The claim modal — flies out FROM the tapped prize ──────────── */}
      <AnimatePresence>
        {claimTarget && <PrizeClaimModal key="prize-claim-modal" target={claimTarget} onClose={closeClaim} />}
      </AnimatePresence>
    </div>
  )
}

/** One prize row — ONE COLUMN, big square tile + level/name/status. */
function PrizeRow({
  lv,
  track,
  locked,
  onTap,
}: {
  lv: CrateLevelRowClient
  track: 'free' | 'crate'
  locked: boolean
  onTap: (lv: CrateLevelRowClient, track: 'free' | 'crate', el: HTMLElement) => void
}) {
  const isFree = track === 'free'
  const emoji = isFree ? lv.freePrizeEmoji : lv.prizeEmoji
  const name = isFree ? lv.freePrizeName : lv.prizeName
  const qty = isFree ? lv.freeQuantity : lv.quantity
  const claimed = isFree ? lv.freeCollected : lv.crateCollected
  const claimable = isFree ? lv.freeClaimable : lv.crateClaimable
  const packLocked = !isFree && locked
  const dim = !claimable && !claimed

  const accent = isFree ? '#30D158' : 'var(--qk-gold)'

  return (
    <button
      onClick={(e) => onTap(lv, track, e.currentTarget)}
      className={`relative w-full flex items-center gap-3 rounded-2xl border p-2 text-left transition-all active:scale-[0.985] ${
        claimable ? 'bg-white/[0.05]' : claimed ? 'bg-white/[0.02]' : 'bg-white/[0.02]'
      }`}
      style={{
        borderColor: claimable
          ? `color-mix(in srgb, ${accent} 45%, transparent)`
          : claimed
            ? `color-mix(in srgb, ${accent} 28%, transparent)`
            : 'rgba(255,255,255,0.08)',
        opacity: dim ? (packLocked ? 0.55 : 0.7) : 1,
      }}
      aria-label={`Level ${lv.level} ${isFree ? 'free' : 'crate'} prize: ${name ?? 'prize'}${qty > 1 ? ` ×${qty}` : ''}${claimable ? ' — tap to claim' : claimed ? ' — claimed' : ' — locked'}`}
      data-testid={`crate-tile-${track}-${lv.level}`}
    >
      {/* The BIG SQUARE tile */}
      <span
        className="relative shrink-0 rounded-2xl border flex items-center justify-center overflow-hidden"
        style={{
          width: 86,
          height: 86,
          borderColor: claimed
            ? `color-mix(in srgb, ${accent} 35%, transparent)`
            : claimable
              ? `color-mix(in srgb, ${accent} 55%, transparent)`
              : 'rgba(255,255,255,0.10)',
          background: claimable
            ? `color-mix(in srgb, ${accent} 12%, transparent)`
            : claimed
              ? 'rgba(255,255,255,0.03)'
              : 'rgba(255,255,255,0.03)',
          boxShadow: claimable ? `0 0 14px color-mix(in srgb, ${accent} 30%, transparent)` : undefined,
        }}
        aria-hidden
      >
        <span className={`text-[34px] leading-none ${packLocked ? 'grayscale' : ''}`}>{emoji ?? '🎁'}</span>
        {qty > 1 && (
          <span className="absolute top-1 right-1 text-[9px] font-black tabular-nums rounded-full px-1.5 py-px bg-black/55 text-white/85">
            ×{qty}
          </span>
        )}
        {claimed && (
          <span
            className="absolute inset-0 flex items-center justify-center bg-black/55"
            style={{ backdropFilter: 'blur(1px)' }}
          >
            <span
              className="flex items-center justify-center w-7 h-7 rounded-full"
              style={{ background: accent }}
              aria-label="claimed"
            >
              <Check className="w-4 h-4 text-black" strokeWidth={3.5} />
            </span>
          </span>
        )}
        {!claimed && !claimable && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/35">
            <Lock className={`w-5 h-5 ${packLocked ? 'text-[var(--qk-gold)]/80' : 'text-white/50'}`} aria-hidden />
          </span>
        )}
        {claimable && <span className="absolute inset-0 rounded-2xl border-2 animate-pulse" style={{ borderColor: `color-mix(in srgb, ${accent} 60%, transparent)` }} />}
      </span>

      {/* Level + name + honest status. The pts badge shows the CUMULATIVE
          crate points this level needs — on EVERY tile, claimed or not. */}
      <span className="min-w-0 flex-1 flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-[10px] font-black tabular-nums text-white/40 uppercase tracking-wider">
          Level {lv.level}
          {!isFree && MILESTONES.includes(lv.level as (typeof MILESTONES)[number]) && (
            <Star className="w-2.5 h-2.5 text-[var(--qk-gold)]" fill="currentColor" aria-hidden />
          )}
          <span
            className="ml-auto rounded-full px-1.5 py-px text-[9px] font-black tabular-nums"
            style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
            title={`${lv.thresholdPoints.toLocaleString()} crate points to reach level ${lv.level}`}
          >
            {formatCompact(lv.thresholdPoints)} pts
          </span>
        </span>
        <span className="text-[14.5px] font-bold truncate text-white/90">{name ?? 'Prize'}</span>
        {claimable ? (
          <span
            className="mt-0.5 self-start flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider"
            style={{ background: `color-mix(in srgb, ${accent} 20%, transparent)`, color: accent }}
          >
            Tap to claim
            <ChevronRight className="w-2.5 h-2.5" aria-hidden />
          </span>
        ) : claimed ? (
          <span className="mt-0.5 text-[10px] font-bold" style={{ color: accent }}>
            Claimed ✓
          </span>
        ) : packLocked ? (
          <span className="mt-0.5 text-[10px] font-bold text-white/45">Get the crate pack to claim</span>
        ) : (
          <span className="mt-0.5 text-[10px] font-bold text-white/45">Locked</span>
        )}
      </span>
    </button>
  )
}

/** A milestone tile in the MAIN PRIZES strip below the progress bar. */
function MainPrizeTile({ lv, unlocked, onTap }: { lv: CrateLevelRowClient; unlocked: boolean; onTap: (lv: CrateLevelRowClient, track: 'free' | 'crate', el: HTMLElement) => void }) {
  const claimable = lv.crateClaimable
  const claimed = lv.crateCollected
  const reached = lv.reached
  return (
    <button
      onClick={(e) => onTap(lv, 'crate', e.currentTarget)}
      className="relative rounded-2xl border overflow-hidden flex flex-col items-center pt-1.5 pb-1 transition-all active:scale-[0.96]"
      style={{
        borderColor: claimable
          ? 'color-mix(in srgb, var(--qk-gold) 60%, transparent)'
          : claimed
            ? 'color-mix(in srgb, var(--qk-gold) 30%, transparent)'
            : 'rgba(255,255,255,0.10)',
        background: claimable
          ? 'color-mix(in srgb, var(--qk-gold) 14%, transparent)'
          : claimed
            ? 'color-mix(in srgb, var(--qk-gold) 8%, transparent)'
            : 'rgba(255,255,255,0.03)',
        opacity: !reached ? 0.6 : 1,
      }}
      aria-label={`Main prize — level ${lv.level}: ${lv.prizeName ?? 'prize'}${claimable ? ' — tap to claim' : claimed ? ' — claimed' : ''}`}
      data-testid={`crate-main-${lv.level}`}
    >
      <span
        className="absolute top-1 left-1 flex items-center justify-center gap-0.5 rounded-full px-1.5 py-px text-[8px] font-black tabular-nums text-black"
        style={{ background: 'var(--qk-gold)' }}
      >
        <Star className="w-2 h-2" fill="currentColor" strokeWidth={0} aria-hidden />
        {lv.level}
      </span>
      <span className="w-full aspect-square flex items-center justify-center">
        <span className={`text-[30px] leading-none ${!unlocked || !reached ? 'grayscale' : ''}`}>{lv.prizeEmoji ?? '🏆'}</span>
      </span>
      <span className="w-full px-1 text-[8px] font-black uppercase tracking-wide text-white/70 text-center truncate">
        {claimed ? 'Claimed' : claimable ? 'Claim now' : `${formatCompact(lv.thresholdPoints)} pts`}
      </span>
      {claimable && <span className="absolute inset-0 rounded-2xl border-2 animate-pulse" style={{ borderColor: 'color-mix(in srgb, var(--qk-gold) 55%, transparent)' }} />}
      {!reached && !claimable && (
        <span className="absolute inset-0 rounded-2xl bg-black/30 flex items-center justify-center">
          <Lock className="w-4 h-4 text-[var(--qk-gold)]/80" aria-hidden />
        </span>
      )}
      {claimed && (
        <span className="absolute inset-0 rounded-2xl bg-black/45 flex items-center justify-center">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[var(--qk-gold)]">
            <Check className="w-3.5 h-3.5 text-black" strokeWidth={3.5} />
          </span>
        </span>
      )}
    </button>
  )
}

/** The CLAIM modal — opens FROM the tapped prize with a spring zoom. */
function PrizeClaimModal({ target, onClose }: { target: ClaimTargetClient; onClose: () => void }) {
  const claimPrize = usePassStore((s) => s.claimPrize)
  const [phase, setPhase] = useState<'offer' | 'claiming' | 'won'>('offer')
  const [wonPrize, setWonPrize] = useState<{ name: string; emoji: string; quantity: number; type: string } | null>(null)

  const isFree = target.track === 'free'
  const lv = target.lv
  const emoji = isFree ? lv.freePrizeEmoji : lv.prizeEmoji
  const name = isFree ? lv.freePrizeName : lv.prizeName
  const qty = isFree ? lv.freeQuantity : lv.quantity

  // The card flies out from the tapped tile toward the screen center.
  const dx = target.cx - (typeof window !== 'undefined' ? window.innerWidth / 2 : 0)
  const dy = target.cy - (typeof window !== 'undefined' ? window.innerHeight / 2 : 0)

  // Won → celebrate briefly, then close automatically.
  useEffect(() => {
    if (phase !== 'won') return
    const t = setTimeout(onClose, 1500)
    return () => clearTimeout(t)
  }, [phase, onClose])

  const onClaim = async () => {
    if (phase !== 'offer') return
    setPhase('claiming')
    const res = await claimPrize(lv.level, isFree ? 'FREE' : 'CRATE')
    if (res.ok) {
      setWonPrize(res.prize)
      setPhase('won')
    } else {
      if (res.error === 'already_claimed') {
        toast('Already claimed', { description: `Level ${lv.level} · ${isFree ? 'FREE' : 'CRATE'} track` })
        onClose()
        return
      }
      if (res.error === 'crate_locked') toast.error('Get the crate pack first')
      else if (res.error === 'level_locked') toast.error('Reach this level first')
      else toast.error('Could not claim — try again')
      setPhase('offer')
    }
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[218]">
      <motion.div
        key="claim-backdrop"
        className="absolute inset-0 bg-black/65"
        style={{ backdropFilter: 'blur(3px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <div className="fixed inset-0 z-[219] flex items-center justify-center p-4 pointer-events-none">
        <motion.div
          role="dialog"
          aria-label={`Claim level ${lv.level} prize`}
          className="relative pointer-events-auto w-[min(86vw,330px)] rounded-3xl border p-5 pt-4 flex flex-col items-center overflow-hidden"
          style={{
            background: 'var(--qk-card)',
            borderColor: 'color-mix(in srgb, var(--qk-gold) 45%, transparent)',
            boxShadow: '0 24px 70px rgba(0,0,0,0.55), 0 0 40px color-mix(in srgb, var(--qk-gold) 18%, transparent)',
          }}
          initial={{ x: dx, y: dy, scale: 0.3, opacity: 0, borderRadius: 60 }}
          animate={{ x: 0, y: 0, scale: 1, opacity: 1, borderRadius: 24 }}
          exit={{ x: dx, y: dy, scale: 0.3, opacity: 0, borderRadius: 60 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        >
          {/* close */}
          <button
            onClick={onClose}
            className="absolute top-2.5 right-2.5 p-1.5 rounded-full hover:bg-white/10 transition z-10"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-white/60" />
          </button>

          {/* label */}
          <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: 'var(--qk-gold)' }}>
            {isFree ? 'Free prize' : 'Crate prize'} · Level {lv.level}
          </p>

          {/* prize stage — rotating rays + the big square prize */}
          <div className="relative w-full h-[168px] flex items-center justify-center mt-2">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[170px] h-[170px] pointer-events-none" aria-hidden>
              <motion.div
                className="w-full h-full rounded-full"
                style={{
                  background:
                    'repeating-conic-gradient(from 0deg, transparent 0deg 14deg, color-mix(in srgb, var(--qk-gold) 26%, transparent) 14deg 17deg, transparent 17deg 30deg)',
                  maskImage: 'radial-gradient(circle, transparent 34%, black 40%, black 72%, transparent 78%)',
                  WebkitMaskImage: 'radial-gradient(circle, transparent 34%, black 40%, black 72%, transparent 78%)',
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
              />
            </div>
            <motion.div
              className="relative rounded-3xl border flex items-center justify-center"
              style={{
                width: 126,
                height: 126,
                borderColor: 'color-mix(in srgb, var(--qk-gold) 60%, transparent)',
                background: 'linear-gradient(160deg, color-mix(in srgb, var(--qk-gold) 16%, transparent), rgba(255,255,255,0.03))',
                boxShadow: '0 10px 30px rgba(0,0,0,0.4), 0 0 26px color-mix(in srgb, var(--qk-gold) 28%, transparent)',
              }}
              initial={{ scale: 0.4, rotate: -14, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.12 }}
            >
              <span className="text-[54px] leading-none drop-shadow-lg">{(phase === 'won' ? wonPrize?.emoji : emoji) ?? '🎁'}</span>
              {qty > 1 && (
                <span className="absolute -top-1.5 -right-1.5 text-[11px] font-black tabular-nums rounded-full px-2 py-0.5 bg-[var(--qk-gold)] text-black border border-black/30">
                  ×{qty}
                </span>
              )}
            </motion.div>
            {/* confetti burst on win */}
            {phase === 'won' && (
              <div className="absolute inset-0 pointer-events-none" aria-hidden>
                {Array.from({ length: 16 }).map((_, i) => {
                  const angle = (i / 16) * Math.PI * 2
                  const dist = 95 + (i % 3) * 34
                  return (
                    <motion.span
                      key={i}
                      className="absolute left-1/2 top-1/2 w-2 h-2 rounded-full"
                      style={{
                        background: i % 3 === 0 ? 'var(--qk-gold)' : i % 3 === 1 ? '#30D158' : 'var(--qk-accent)',
                      }}
                      initial={{ x: 0, y: 0, opacity: 1, scale: 0.5 }}
                      animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, opacity: 0, scale: 1.15 }}
                      transition={{ duration: 0.85, ease: 'easeOut' }}
                    />
                  )
                })}
              </div>
            )}
          </div>

          {/* name + quantity */}
          <p className="text-[17px] font-black text-white text-center leading-tight mt-1.5">
            {phase === 'won' ? wonPrize?.name : name ?? 'Prize'}
          </p>
          <p className="text-[11.5px] font-bold text-white/55 mt-0.5 tabular-nums">
            {phase === 'won' && wonPrize
              ? wonPrize.type === 'COINS'
                ? `+${wonPrize.quantity.toLocaleString()} coins added to your balance`
                : `×${wonPrize.quantity} added to your gifts`
              : qty > 1
                ? `You will receive ×${qty}`
                : 'Tap claim to receive it'}
          </p>

          {/* CTA */}
          {phase === 'won' ? (
            <motion.div
              className="mt-4 w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-[14px] font-black text-black"
              style={{ background: '#30D158' }}
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 16 }}
            >
              <Check className="w-5 h-5" strokeWidth={3.5} aria-hidden />
              Prize claimed!
            </motion.div>
          ) : (
            <motion.button
              onClick={() => void onClaim()}
              disabled={phase === 'claiming'}
              className="mt-4 w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-black text-black disabled:opacity-70 active:scale-[0.98] transition-transform"
              style={{
                background: 'linear-gradient(180deg, color-mix(in srgb, var(--qk-gold) 82%, white), var(--qk-gold))',
                boxShadow: '0 8px 24px color-mix(in srgb, var(--qk-gold) 35%, transparent)',
              }}
              animate={phase === 'offer' ? { scale: [1, 1.03, 1] } : { scale: 1 }}
              transition={{ duration: 1.6, repeat: phase === 'offer' ? Infinity : 0, ease: 'easeInOut' }}
              data-testid="claim-prize-button"
            >
              {phase === 'claiming' ? (
                <>
                  <span className="w-4.5 h-4.5 rounded-full border-2 border-black/40 border-t-black animate-spin" aria-hidden />
                  Claiming…
                </>
              ) : (
                <>
                  <Sparkles className="w-4.5 h-4.5" aria-hidden />
                  CLAIM
                </>
              )}
            </motion.button>
          )}
        </motion.div>
      </div>
    </div>,
    document.body
  )
}
