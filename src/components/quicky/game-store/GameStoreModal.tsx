'use client'

// Quicky — GAME STORE (Game Economy PRD §5/§6/§72)
//
// The Games section's OWN store — never called "Premium" (§72): the dating
// subscription is a completely separate system (§71). Branded "Game Store"
// with the four tabs (§6):
//     [ Coins ] [ Crates ] [ Cosmetics ] [ Featured ]
//
// Presentation follows the app's overlay conventions: mobile web/Capacitor
// → a DEDICATED SLIDING SCREEN (fixed inset-0, pushes in from the right);
// desktop web → a CENTERED MODAL. Portaled to document.body so no parent
// stacking context can trap it.
//
// The coin balance header (§73 "🪙 Game Coins") is always visible; the
// sandbox payment adapter is clearly labelled (§69 — no real money moves).

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Coins, Package, Sparkles, Flame } from 'lucide-react'
import { useGameStoreStore, type StoreTab } from '@/store/game-store'
import { useIsDesktopShell } from '@/hooks/useIsDesktopShell'
import { cn } from '@/lib/utils'
import { CoinsTab, CratesTab, CosmeticsTab, FeaturedTab } from './GameStoreTabs'
import { CrateRevealModal } from './CrateRevealModal'

const TABS: { key: StoreTab; label: string; icon: typeof Coins }[] = [
  { key: 'coins', label: 'Coins', icon: Coins },
  { key: 'crates', label: 'Crates', icon: Package },
  { key: 'cosmetics', label: 'Cosmetics', icon: Sparkles },
  { key: 'featured', label: 'Featured', icon: Flame },
]

export function GameStoreModal() {
  const open = useGameStoreStore((s) => s.open)
  const tab = useGameStoreStore((s) => s.tab)
  const setTab = useGameStoreStore((s) => s.setTab)
  const closeStore = useGameStoreStore((s) => s.closeStore)
  const payload = useGameStoreStore((s) => s.payload)
  const loading = useGameStoreStore((s) => s.loading)
  const isDesk = useIsDesktopShell() === true

  // Escape closes the store (desktop keyboard parity with other overlays).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useGameStoreStore.getState().closeStore()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      <AnimatePresence>
        {open &&
          (isDesk ? (
            // ── DESKTOP: centered modal ──────────────────────────────────
            <motion.div
              key="game-store-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[214] bg-black/60 backdrop-blur-[2px]"
              onClick={closeStore}
              data-testid="game-store-backdrop"
            />
          ) : null)}
      </AnimatePresence>

      <AnimatePresence>
        {open &&
          (isDesk ? (
            <motion.div
              key="game-store-modal"
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[215] w-[480px] max-w-[94vw] max-h-[88vh] flex flex-col rounded-3xl border border-white/12 bg-[var(--qk-bg)] text-white shadow-2xl overflow-hidden"
              role="dialog"
              aria-label="Game Store"
              data-testid="game-store-modal"
            >
              <StoreBody tab={tab} setTab={setTab} closeStore={closeStore} payload={payload} loading={loading} />
            </motion.div>
          ) : (
            <motion.div
              key="game-store-screen"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              className="fixed inset-0 z-[212] bg-[var(--qk-bg)] text-white flex flex-col safe-area-top"
              role="dialog"
              aria-label="Game Store"
              data-testid="game-store-screen"
            >
              <StoreBody tab={tab} setTab={setTab} closeStore={closeStore} payload={payload} loading={loading} />
            </motion.div>
          ))}
      </AnimatePresence>

      {/* Crate purchase → open → reward reveal (own overlay, PRD §45/§46). */}
      <CrateRevealModal />
    </>,
    document.body
  )
}

function StoreBody({
  tab,
  setTab,
  closeStore,
  payload,
  loading,
}: {
  tab: StoreTab
  setTab: (t: StoreTab) => void
  closeStore: () => void
  payload: ReturnType<typeof useGameStoreStore.getState>['payload']
  loading: boolean
}) {
  const balance = payload?.coinBalance ?? 0

  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
      {/* Header — GAME STORE + balance (PRD §6/§73) */}
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-white/8">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
              <span className="w-8 h-8 rounded-2xl bg-[var(--qk-gold)]/15 flex items-center justify-center shrink-0">
                <Coins className="w-4.5 h-4.5 text-[var(--qk-gold)]" />
              </span>
              Game Store
            </h2>
            <p className="text-xs text-white/50 mt-1">
              Balance:{' '}
              <b className="text-[var(--qk-gold)] tabular-nums" data-testid="game-store-balance">
                🪙 {balance.toLocaleString('en-US')}
              </b>{' '}
              Game Coins
            </p>
          </div>
          <button
            className="p-2.5 rounded-full hover:bg-white/10 transition-colors"
            onClick={closeStore}
            aria-label="Close Game Store"
            data-testid="game-store-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs (PRD §6) */}
        <div className="flex gap-1.5 mt-3" role="tablist" aria-label="Game Store sections">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[12px] font-bold transition-all active:scale-[0.97]',
                tab === key
                  ? 'bg-[var(--qk-accent)]/18 text-white border border-[var(--qk-accent)]/40'
                  : 'bg-white/5 text-white/60 border border-white/8 hover:bg-white/10'
              )}
              data-testid={`game-store-tab-${key}`}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        {/* Final-hours boost banner (PRD §24/§51) — shown across tabs */}
        {payload?.boost?.active && (
          <div
            className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 border"
            style={{
              background: 'color-mix(in srgb, var(--qk-accent) 16%, transparent)',
              borderColor: 'color-mix(in srgb, var(--qk-accent) 40%, transparent)',
            }}
            data-testid="game-store-boost-banner"
          >
            <span aria-hidden>🔥</span>
            <span className="font-black text-[12px]" style={{ color: 'var(--qk-accent)' }}>
              {payload.boost.multiplier}× REALM BOOST
            </span>
            <span className="text-[11px] font-semibold text-white/70 truncate">Gifts earn {payload.boost.multiplier}× ❤️ realm points</span>
          </div>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto qk-desk-scroll">
        {tab === 'coins' && <CoinsTab />}
        {tab === 'crates' && <CratesTab />}
        {tab === 'cosmetics' && <CosmeticsTab />}
        {tab === 'featured' && <FeaturedTab />}
      </div>
    </div>
  )
}
