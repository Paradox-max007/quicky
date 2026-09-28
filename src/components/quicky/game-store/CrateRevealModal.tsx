'use client'

// Quicky — CRATE REVEAL MODAL (Game Economy PRD §45/§46)
//
// Purchase and open are SEPARATE (§46): payment success creates the OWNED
// entitlement; THIS modal is where the user opens it. Sequence (§45):
//     crate appears → glow → open → reward reveal → ❤️ hearts fly
//
// The server does all granting (idempotent); this modal is pure theatre +
// the authoritative response values. Framer-motion only — no CSS
// fill-mode: both/forwards animations (app convention).

import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useGameStoreStore } from '@/store/game-store'
import { GiftIcon } from '../GiftIcon'

export function CrateRevealModal() {
  const reveal = useGameStoreStore((s) => s.reveal)
  const revealCrate = useGameStoreStore((s) => s.revealCrate)
  const openingCrateId = useGameStoreStore((s) => s.openingCrateId)
  const busy = useGameStoreStore((s) => s.busy)
  const openCrate = useGameStoreStore((s) => s.openCrate)
  const closeReveal = useGameStoreStore((s) => s.closeReveal)

  const visible = !!(reveal || openingCrateId)
  const emoji = revealCrate?.emoji ?? '💎'
  const name = revealCrate?.name ?? 'Crate'

  // ❤️ particles — realm hearts fly to the counter (PRD §45).
  const hearts = useMemo(
    () =>
      Array.from({ length: reveal ? Math.min(8, Math.max(3, Math.round(reveal.realmPoints / 120))) : 0 }, (_, i) => ({
        id: i,
        x: -60 + Math.random() * 120,
        delay: Math.random() * 0.5,
        size: 14 + Math.random() * 12,
        drift: -30 + Math.random() * 60,
      })),
    [reveal]
  )

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          key="crate-reveal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[216] flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
          onClick={() => (reveal ? closeReveal() : undefined)}
          role="dialog"
          aria-label="Open crate"
          data-testid="crate-reveal-modal"
        >
          <motion.div
            initial={{ scale: 0.85, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 360, damping: 26 }}
            className="w-full max-w-sm rounded-3xl border border-white/12 bg-[var(--qk-card)] p-5 flex flex-col items-center gap-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {!reveal ? (
              // ── Phase 1: the paid crate awaits opening (PRD §46) ──────────
              <>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#30D158]">
                  Purchase complete
                </p>
                <div className="relative w-36 h-36 flex items-center justify-center">
                  {/* glow rings */}
                  {[0, 1].map((i) => (
                    <motion.span
                      key={i}
                      className="absolute inset-0 rounded-full"
                      style={{ border: '2px solid color-mix(in srgb, var(--qk-gold) 55%, transparent)' }}
                      animate={{ scale: [1, 1.35], opacity: [0.6, 0] }}
                      transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.8 }}
                      aria-hidden
                    />
                  ))}
                  <motion.span
                    className="text-[64px] leading-none drop-shadow-[0_0_24px_rgba(255,200,60,0.45)]"
                    animate={busy ? { rotate: [0, -6, 6, -6, 6, 0], scale: [1, 1.06, 1] } : { scale: [1, 1.04, 1] }}
                    transition={busy ? { duration: 0.5 } : { duration: 2, repeat: Infinity }}
                    aria-hidden
                  >
                    {emoji}
                  </motion.span>
                </div>
                <div>
                  <p className="font-black text-base">{name}</p>
                  <p className="text-xs text-white/50 mt-1">Paid &amp; secured — open it to claim your rewards.</p>
                </div>
                <button
                  onClick={() => void openCrate(openingCrateId ?? '', { name, emoji })}
                  disabled={!!busy}
                  className="w-full rounded-2xl py-3.5 font-black text-[14px] text-white bg-coral-gradient glow-coral disabled:opacity-40 transition-all active:scale-[0.98]"
                  data-testid="crate-reveal-open-btn"
                >
                  {busy ? 'Opening…' : '🎁 Open Crate'}
                </button>
              </>
            ) : (
              // ── Phase 2: reward reveal (PRD §45: hearts fly, total +N) ──
              <>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--qk-gold)]">
                  Rewards unlocked
                </p>

                {/* The hearts fly toward the realm counter */}
                <div className="relative w-full h-24 flex items-center justify-center overflow-visible">
                  {hearts.map((h) => (
                    <motion.span
                      key={h.id}
                      className="absolute"
                      style={{ fontSize: h.size }}
                      initial={{ x: 0, y: 0, opacity: 0 }}
                      animate={{ x: h.x + h.drift, y: -90, opacity: [0, 1, 1, 0] }}
                      transition={{ duration: 1.4, delay: 0.15 + h.delay, ease: 'easeOut' }}
                      aria-hidden
                    >
                      ❤️
                    </motion.span>
                  ))}
                  <motion.span
                    className="text-5xl"
                    initial={{ scale: 0.6, rotate: -12 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                    aria-hidden
                  >
                    {emoji}
                  </motion.span>
                </div>

                <div className="w-full flex flex-col gap-2">
                  {reveal.realmPoints > 0 && (
                    <RewardRow
                      icon={<span className="text-lg" aria-hidden>❤️</span>}
                      label="Realm Points"
                      value={`+${reveal.realmPoints.toLocaleString('en-US')}`}
                      accent
                    />
                  )}
                  {reveal.coins > 0 && (
                    <RewardRow
                      icon={<span className="text-lg" aria-hidden>🪙</span>}
                      label="Game Coins"
                      value={`+${reveal.coins.toLocaleString('en-US')}`}
                    />
                  )}
                  {reveal.gift && (
                    <RewardRow
                      icon={<GiftIcon icon={reveal.gift.emoji} iconType="emoji" className="h-4 w-4 text-base" imgClassName="h-4 w-4" />}
                      label={reveal.gift.name}
                      value={reveal.gift.quantity > 1 ? `×${reveal.gift.quantity}` : 'Added'}
                    />
                  )}
                  {reveal.cosmetic && (
                    <RewardRow
                      icon={<span className="text-lg" aria-hidden>{reveal.cosmetic.icon}</span>}
                      label={reveal.cosmetic.name}
                      value="Unlocked"
                    />
                  )}
                </div>

                <p className="text-[11px] text-white/50">
                  Balance:{' '}
                  <b className="text-[var(--qk-gold)] tabular-nums">🪙 {reveal.coinBalance.toLocaleString('en-US')}</b>
                  {reveal.realmPoints > 0 && (
                    <>
                      {' · '}
                      <span style={{ color: 'var(--qk-accent)' }}>
                        {reveal.realmPointsAwarded ? 'realm total updated' : 'realm points already applied'}
                      </span>
                    </>
                  )}
                </p>

                <button
                  onClick={closeReveal}
                  className="w-full rounded-2xl py-3.5 font-black text-[14px] text-white bg-coral-gradient glow-coral transition-all active:scale-[0.98]"
                  data-testid="crate-reveal-done-btn"
                >
                  Collect
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

function RewardRow({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -18 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5"
    >
      <span className="w-8 h-8 rounded-lg bg-white/8 flex items-center justify-center shrink-0">{icon}</span>
      <span className="flex-1 min-w-0 text-left text-[13px] font-bold truncate">{label}</span>
      <span
        className="text-[13px] font-black tabular-nums"
        style={{ color: accent ? 'var(--qk-accent)' : 'var(--qk-gold)' }}
      >
        {value}
      </span>
    </motion.div>
  )
}
