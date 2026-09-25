'use client'

// Quicky — REALM PASS SCREEN (crate-pass PRD — screen 1, opened by the 👑 chip)
//
//   · TOP: the viewer's CURRENT REALM details (name/level, cycle points vs
//     threshold, rank, cycle countdown)
//   · MIDDLE: the CRATES store — basic details per crate (image, name, what
//     it is, level progress when owned)
//   · BOTTOM: the "GET CRATE" button → opens the crate DETAILS screen
//     (screen 2: packs + the 100-level prize track)
//
// SINGLE SCREEN, NO OVERFLOW: the whole pass fits one viewport — the layout
// is a fixed flex column (only the crate list may scroll internally when an
// admin configures many crates).
//
// Presentation: mobile web/Capacitor → a DEDICATED SLIDING SCREEN (fixed
// inset-0, pushes in from the right like native navigation; the room or page
// underneath NEVER unmounts). Desktop web → a MODAL IN THE CENTER of the
// screen. Screen 2 (CrateDetailsScreen) slides over this one on mobile and
// swaps the modal content on desktop.

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ArrowLeft, Crown, ChevronRight, Timer } from 'lucide-react'
import { useRealmStore } from '@/store/realm'
import { usePassStore, type CrateCatalogRowClient } from '@/store/pass'
import { useIsDesktopShell } from '@/hooks/useIsDesktopShell'
import { formatCompact } from '@/lib/quicky/format'
import { RealmCycleTimer } from '@/components/quicky/realm/RealmProgress'
import { CrateDetailsContent, CrateDetailsScreen } from './CrateDetailsScreen'

export function RealmPassScreen() {
  const passOpen = usePassStore((s) => s.passOpen)
  const closePass = usePassStore((s) => s.closePass)
  const backToStore = usePassStore((s) => s.backToStore)
  const crateId = usePassStore((s) => s.crateId)
  const isDesk = useIsDesktopShell() === true

  return (
    <AnimatePresence>
      {passOpen &&
        (isDesk ? (
          // ── DESKTOP: one centered modal; content swaps store ↔ details ──
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[210] bg-black/55 backdrop-blur-[2px]"
              onClick={crateId ? backToStore : closePass}
              data-testid="pass-backdrop"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[211] w-[460px] max-w-[94vw] max-h-[88vh] flex flex-col rounded-3xl border border-white/12 bg-[var(--qk-bg)] text-white shadow-2xl overflow-hidden"
              role="dialog"
              aria-label="Realm pass"
              data-testid="pass-modal"
            >
              {crateId ? <CrateDetailsContent /> : <PassContent />}
            </motion.div>
          </>
        ) : (
          // ── MOBILE / CAPACITOR: dedicated sliding screens ────────────────
          <>
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              className="fixed inset-0 z-[205] bg-[var(--qk-bg)] text-white flex flex-col"
              role="dialog"
              aria-label="Realm pass"
              data-testid="pass-screen"
            >
              <PassContent />
            </motion.div>
            {/* Screen 2 slides OVER the pass screen (stacked navigation). */}
            <CrateDetailsScreen />
          </>
        ))}
    </AnimatePresence>
  )
}

/** Screen 1 — realm details + crate store + Get Crate (no page overflow). */
function PassContent() {
  const isDesk = useIsDesktopShell() === true
  const closePass = usePassStore((s) => s.closePass)
  const openCrate = usePassStore((s) => s.openCrate)
  const crates = usePassStore((s) => s.crates)
  const cratesLoaded = usePassStore((s) => s.cratesLoaded)
  const snapshot = useRealmStore((s) => s.snapshot)
  const refreshRealm = useRealmStore((s) => s.refresh)
  const [selected, setSelected] = useState<string | null>(null)

  // Fresh realm standings every time the pass opens (§68 — same rule as the
  // leaderboard).
  useEffect(() => {
    if (usePassStore.getState().passOpen) void refreshRealm()
  }, [refreshRealm])

  const list = crates ?? []
  const selectedCrate = list.find((c) => c.id === selected) ?? list[0] ?? null

  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className={`shrink-0 flex items-center gap-2 px-4 py-3 border-b border-white/8 ${isDesk ? '' : 'app-safe-top'}`}>
        <button
          onClick={closePass}
          className="p-2 -ml-1 rounded-full hover:bg-white/8 active:scale-95 transition"
          aria-label="Close realm pass"
          data-testid="pass-close"
        >
          {isDesk ? <X className="w-5 h-5" /> : <ArrowLeft className="w-5 h-5" />}
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <Crown className="w-5 h-5 text-[var(--qk-gold)]" aria-hidden />
            Realm Pass
          </h1>
          <p className="text-[11px] text-white/40">Battle pass · free + crate prizes · win realms to climb</p>
        </div>
      </div>

      {/* ── Body: fixed flex column — fits the screen, no page scroll ───── */}
      <div className="flex-1 min-h-0 flex flex-col gap-3 px-4 py-3.5 overflow-hidden">
        {/* Current realm details */}
        {snapshot ? (
          <div className="shrink-0 rounded-2xl border border-white/10 bg-white/5 p-3.5" data-testid="pass-realm-card">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[var(--qk-gold)]/15 border border-[var(--qk-gold)]/25 flex items-center justify-center shrink-0">
                <Crown className="w-5 h-5 text-[var(--qk-gold)]" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[9.5px] font-black uppercase tracking-[0.18em] text-white/40">Your realm</p>
                <p className="text-[15px] font-bold truncate">
                  {snapshot.realm.name} <span className="text-[11px] font-bold text-white/45">Lv {snapshot.realm.level}</span>
                </p>
              </div>
              {snapshot.cycle && (
                <span className="shrink-0 flex items-center gap-1 text-[10.5px] font-bold tabular-nums text-[var(--qk-gold)]">
                  <Timer className="w-3.5 h-3.5" aria-hidden />
                  <RealmCycleTimer endsAt={snapshot.cycle.endsAt} />
                </span>
              )}
            </div>
            {/* Cycle points vs threshold */}
            <div className="mt-2.5">
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="font-bold text-white/70">
                  Cycle points <span className="font-black text-white tabular-nums">{snapshot.points.toLocaleString()}</span>
                </span>
                <span className="font-bold text-white/45 tabular-nums">
                  {snapshot.threshold > 0 ? `${snapshot.threshold.toLocaleString()} to qualify` : 'MAX realm'}
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-white/8 overflow-hidden" role="progressbar">
                <div
                  className="h-full rounded-full bg-[var(--qk-gold)]"
                  style={{ width: `${snapshot.threshold > 0 ? Math.min(100, (snapshot.points / snapshot.threshold) * 100) : 100}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-[10.5px] font-semibold text-white/50">
                {snapshot.rank != null && <span>Rank <b className="text-white tabular-nums">#{snapshot.rank}</b> / {snapshot.cohortSize}</span>}
                <span>Next: <b className="text-white/80">{snapshot.nextRealm?.name ?? 'Season rollover'}</b></span>
              </div>
            </div>
          </div>
        ) : (
          <div className="shrink-0 rounded-2xl border border-white/8 bg-white/[0.03] p-4 flex justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
          </div>
        )}

        {/* Crate store */}
        <div className="min-h-0 flex-1 flex flex-col">
          <p className="shrink-0 text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-2">Crates — the battle pass store</p>
          <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar flex flex-col gap-2">
            {!cratesLoaded && list.length === 0 && (
              <div className="flex justify-center py-6">
                <div className="w-6 h-6 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
              </div>
            )}
            {cratesLoaded && list.length === 0 && (
              <p className="text-center text-[11.5px] text-white/40 py-5">No crates yet — check back soon.</p>
            )}
            {list.map((crate) => (
              <CrateStoreCard
                key={crate.id}
                crate={crate}
                selected={selectedCrate?.id === crate.id}
                onSelect={() => setSelected(crate.id)}
              />
            ))}
          </div>
        </div>

        {/* Get Crate — the bottom action */}
        {selectedCrate && (
          <button
            onClick={() => openCrate(selectedCrate.id)}
            className="shrink-0 w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-[14.5px] font-black active:scale-[0.98] transition-transform border"
            style={{
              background: 'color-mix(in srgb, var(--qk-gold) 20%, transparent)',
              borderColor: 'color-mix(in srgb, var(--qk-gold) 45%, transparent)',
              color: 'var(--qk-gold)',
            }}
            aria-label={selectedCrate.unlocked ? `Open ${selectedCrate.name}` : `Get ${selectedCrate.name} — ${selectedCrate.priceCoins} coins`}
            data-testid="pass-get-crate"
          >
            {selectedCrate.unlocked ? 'Open Crate' : `Get Crate Pack · ${selectedCrate.priceCoins.toLocaleString()} 🪙`}
            <ChevronRight className="w-4.5 h-4.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}

/** One crate in the store: image, name, one-line description, progress. */
function CrateStoreCard({ crate, selected, onSelect }: { crate: CrateCatalogRowClient; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-2xl border p-3 flex items-center gap-3 transition-colors ${
        selected ? 'border-[var(--qk-gold)]/50 bg-[var(--qk-gold)]/8' : 'border-white/10 bg-white/[0.03] hover:bg-white/5'
      }`}
      aria-pressed={selected}
      data-testid={`pass-crate-card-${crate.id}`}
    >
      {crate.imageUrl ? (
        <img src={crate.imageUrl} alt="" className="w-11 h-11 rounded-xl object-cover shrink-0 border border-white/10" />
      ) : (
        <span className="w-11 h-11 rounded-xl bg-[var(--qk-gold)]/12 border border-[var(--qk-gold)]/25 flex items-center justify-center text-[20px] shrink-0" aria-hidden>
          🎁
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-[13.5px] font-bold truncate">{crate.name}</p>
          {crate.isPointsTarget && (
            <span
              className="shrink-0 text-[8.5px] font-black uppercase tracking-wide rounded-full px-1.5 py-0.5"
              style={{ background: 'color-mix(in srgb, var(--qk-gold) 22%, transparent)', color: 'var(--qk-gold)' }}
              title="Realm wins feed this crate's levels"
            >
              Current
            </span>
          )}
        </div>
        <p className="text-[11px] text-white/45 truncate">{crate.description ?? 'The 100-level battle pass.'}</p>
        {crate.unlocked ? (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-white/8 overflow-hidden">
              <div className="h-full rounded-full bg-[var(--qk-gold)]" style={{ width: `${(crate.currentLevel / Math.max(1, crate.levelCount)) * 100}%` }} />
            </div>
            <span className="text-[10px] font-black tabular-nums text-[var(--qk-gold)]">
              {formatCompact(crate.currentLevel)}/{formatCompact(crate.levelCount)}
            </span>
          </div>
        ) : (
          <p className="mt-1 text-[10.5px] font-bold text-white/50">
            {crate.cratePoints > 0 ? `${formatCompact(crate.cratePoints)} points waiting — claim free prizes on the track` : `${formatCompact(crate.levelCount)} levels · free + crate prizes`}
          </p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-white/30 shrink-0" aria-hidden />
    </button>
  )
}
