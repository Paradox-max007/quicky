'use client'

// Quicky — CRATE DETAILS SCREEN (crate-pass PRD — screen 2)
//
// Opened by "Get Crate" on the Realm Pass:
//   · the crate's details (image, name, description)
//   · UNLOCK ("get crate") CTA while locked — coins, admin-configured price;
//     any crate points earned from realm wins apply instantly on unlock
//   · CRATE PACKS once unlocked — bundles of the next 1/5/10/25 levels priced
//     as the sum of their per-level prices
//   · the 100-LEVEL PRIZE TRACK — every level's prize + its buy price, with
//     the reached levels highlighted (this section scrolls internally)
//
// Presentation mirrors screen 1: a dedicated sliding screen on mobile
// web/Capacitor (pushes over the pass screen — stacked navigation), and the
// centered modal's content on desktop web.

import { motion, AnimatePresence } from 'framer-motion'
import { X, ArrowLeft, Lock, Check, Sparkles, Coins } from 'lucide-react'
import { toast } from 'sonner'
import { usePassStore, type CrateLevelRowClient, type CratePackRowClient } from '@/store/pass'
import { useIsDesktopShell } from '@/hooks/useIsDesktopShell'
import { formatCompact } from '@/lib/quicky/format'

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
          aria-label="Crate details"
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
  const busy = usePassStore((s) => s.busy)
  const backToStore = usePassStore((s) => s.backToStore)
  const closePass = usePassStore((s) => s.closePass)
  const purchaseCrate = usePassStore((s) => s.purchaseCrate)
  const buyLevels = usePassStore((s) => s.buyLevels)

  if (!crateId) return null

  const crate = detail?.crate ?? null

  const onUnlock = async () => {
    if (!crate || busy) return
    const res = await purchaseCrate(crate.id)
    if (res.ok) {
      toast.success('Crate unlocked!', { description: 'Every level your crate points earned just popped.' })
    } else if (res.error === 'insufficient_coins') {
      toast.error('Not enough coins', { description: 'Win more games or grab coins from the store.' })
    } else if (res.error !== 'already_unlocked') {
      toast.error('Could not unlock the crate — try again.')
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
          <p className="text-[11px] text-white/40">100 levels · prize every level</p>
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
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto no-scrollbar px-4 py-3.5 gap-3.5">
          {/* ── Crate hero ─────────────────────────────────────────────── */}
          <div className="shrink-0 rounded-2xl border border-white/10 bg-white/5 p-3.5 flex items-center gap-3">
            {crate.imageUrl ? (
              <img src={crate.imageUrl} alt="" className="w-14 h-14 rounded-2xl object-cover shrink-0 border border-white/10" />
            ) : (
              <span className="w-14 h-14 rounded-2xl bg-[var(--qk-gold)]/12 border border-[var(--qk-gold)]/25 flex items-center justify-center text-[26px] shrink-0" aria-hidden>
                🎁
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold">{crate.name}</p>
              <p className="text-[11px] text-white/45 leading-snug line-clamp-2">{crate.description ?? 'The realm pass — win realms to climb 100 prize levels.'}</p>
            </div>
          </div>

          {/* ── Progress + unlock / packs ───────────────────────────────── */}
          {crate.unlocked ? (
            <div className="shrink-0 rounded-2xl border border-white/10 bg-[var(--qk-card)]/60 p-3.5" data-testid="crate-progress">
              <div className="flex items-baseline justify-between text-[11.5px]">
                <span className="font-bold text-white/70">
                  Level <b className="text-white font-black tabular-nums text-[14px]">{crate.currentLevel}</b>
                  <span className="text-white/40"> / {crate.levelCount}</span>
                </span>
                <span className="font-bold text-[var(--qk-gold)] tabular-nums flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" aria-hidden />
                  {formatCompact(crate.cratePoints)} crate pts
                </span>
              </div>
              <div className="mt-2 h-2.5 rounded-full bg-white/8 overflow-hidden">
                <div className="h-full rounded-full bg-[var(--qk-gold)]" style={{ width: `${(crate.currentLevel / Math.max(1, crate.levelCount)) * 100}%` }} />
              </div>
              <p className="mt-2 text-[10.5px] font-semibold text-white/45 leading-relaxed">
                Win realms for crate points (each point = one level) or buy levels below — every level unlocks its prize instantly.
              </p>
            </div>
          ) : (
            <div className="shrink-0 rounded-2xl border border-[var(--qk-gold)]/30 bg-[var(--qk-gold)]/8 p-3.5" data-testid="crate-locked">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-[var(--qk-gold)]/15 flex items-center justify-center shrink-0" aria-hidden>
                  <Lock className="w-4.5 h-4.5 text-[var(--qk-gold)]" />
                </span>
                <p className="flex-1 min-w-0 text-[11.5px] font-semibold text-white/70 leading-snug">
                  Unlock to open the 100-level prize track.
                  {crate.cratePoints > 0 && (
                    <b className="text-[var(--qk-gold)]"> {formatCompact(crate.cratePoints)} crate points</b>
                  )}
                  {crate.cratePoints > 0 ? ' are waiting — levels pop the moment you unlock.' : ''}
                </p>
              </div>
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
                <Coins className="w-4.5 h-4.5" aria-hidden />
                Get Crate · {crate.priceCoins.toLocaleString()} coins
              </button>
            </div>
          )}

          {/* ── Packs (multiple crates packs — buy levels in bundles) ──── */}
          {crate.unlocked && (detail.packs?.length ?? 0) > 0 && (
            <div className="shrink-0" data-testid="crate-packs">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-2">Crate packs</p>
              <div className="grid grid-cols-2 gap-2">
                {detail.packs.map((pack) => (
                  <button
                    key={pack.levels}
                    onClick={() => void onBuyPack(pack)}
                    disabled={busy || !pack.affordable}
                    className={`rounded-2xl border p-3 text-left transition-colors ${
                      pack.affordable ? 'border-white/10 bg-white/[0.04] hover:bg-white/8 active:scale-[0.98]' : 'border-white/6 bg-white/[0.02] opacity-55'
                    }`}
                    data-testid={`crate-pack-${pack.levels}`}
                  >
                    <p className="text-[13px] font-black">{pack.label}</p>
                    <p className="text-[10.5px] text-white/45 mt-0.5">next {pack.levels} level{pack.levels > 1 ? 's' : ''}</p>
                    <p className="mt-1.5 flex items-center gap-1 text-[12px] font-black tabular-nums" style={{ color: 'var(--qk-gold)' }}>
                      <Coins className="w-3.5 h-3.5" aria-hidden />
                      {pack.priceCoins.toLocaleString()}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── The 100-level prize track (scrolls internally) ──────────── */}
          <div className="min-h-0" data-testid="crate-levels">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-2">Prize track</p>
            <div className="flex flex-col gap-1.5">
              {(detail.levels ?? []).map((lv) => (
                <LevelRow key={lv.level} level={lv} />
              ))}
              {(detail.levels ?? []).length === 0 && (
                <p className="text-center text-[11.5px] text-white/40 py-5">This crate has no levels configured yet.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LevelRow({ level }: { level: CrateLevelRowClient }) {
  const reached = level.reached
  return (
    <div
      className={`flex items-center gap-2.5 rounded-2xl px-3 py-2 border ${
        reached ? 'border-[var(--qk-gold)]/35 bg-[var(--qk-gold)]/8' : 'border-white/8 bg-white/[0.02]'
      }`}
      data-testid={`crate-level-${level.level}`}
    >
      <span
        className={`w-7 shrink-0 text-center text-[11px] font-black tabular-nums rounded-lg py-1 ${
          reached ? 'bg-[var(--qk-gold)]/20 text-[var(--qk-gold)]' : 'bg-white/6 text-white/45'
        }`}
        aria-label={`Level ${level.level}`}
      >
        {level.level}
      </span>
      <span className="text-[15px] shrink-0" aria-hidden>{level.prizeEmoji ?? '🎁'}</span>
      <p className={`flex-1 min-w-0 truncate text-[12px] font-bold ${reached ? '' : 'text-white/70'}`}>
        {level.prizeName ?? 'Prize'}
        {level.quantity > 1 && <span className="ml-1 font-black text-white/45">×{level.quantity}</span>}
      </p>
      {reached ? (
        <span className="shrink-0 flex items-center gap-1 text-[10px] font-black uppercase tracking-wide" style={{ color: 'var(--qk-gold)' }}>
          <Check className="w-3.5 h-3.5" aria-hidden />
          Unlocked
        </span>
      ) : (
        <span className="shrink-0 flex items-center gap-1 text-[10.5px] font-bold tabular-nums text-white/45">
          <Coins className="w-3.5 h-3.5" aria-hidden />
          {level.priceCoins.toLocaleString()}
        </span>
      )}
    </div>
  )
}
