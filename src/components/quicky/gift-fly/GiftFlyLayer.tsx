'use client'

// Quicky — GIFT FLY LAYER (gifting-revision: sender → receiver animation)
//
// THE moving gift animation: when a gift is sent, its icons FLY across the
// screen from the SENDER's seat to the RECEIVER's seat. Both room games tag
// every player surface (seat cards, Ludo yard avatars, HUD chips) with
// data-room-seat="<userId>", so the layer resolves real viewport positions
// at launch time — no props, no wiring, works from any send surface (the
// player toolbox, the bulk gift sheet, the gift-back sheet).
//
// CONTINUOUS FLOW: quantity N renders up to CAP icons launched with a
// staggered cadence (10 gifts → 10 icons streaming one after another); when
// the quantity exceeds the cap the LAST icon carries a "×N" badge so the
// full amount still reads. The final landing fires an arrival burst (glow
// ring + sparkle) at the receiver's seat.
//
// Receiver side: the room-channel gift broadcast ALSO launches the flight
// (sender's seat → MY seat) — both participants see the gift travel.
//
// Rendering: fixed, pointer-events-none overlay above the alert drawers
// (z-234) — the game underneath stays fully tappable. Prefers-reduced-
// motion skips the flight entirely (a plain toast still confirms the send).

import { create } from 'zustand'
import { motion } from 'framer-motion'
import { GiftIcon } from '@/components/quicky/GiftIcon'

type Point = { x: number; y: number }

export type GiftFlight = {
  key: number
  from: Point
  to: Point
  icon: string
  iconType?: string | null
  /** Icons actually rendered (quantity, capped). */
  count: number
  /** Shown on the last icon when quantity > count ("×1000"). */
  badge: number | null
}

type GiftFlyState = {
  flights: GiftFlight[]
  push: (f: GiftFlight) => void
  remove: (key: number) => void
}

const useGiftFlyStore = create<GiftFlyState>((set) => ({
  flights: [],
  push: (f) => set((prev) => ({ flights: [...prev.flights.slice(-5), f] })),
  remove: (key) => set((prev) => ({ flights: prev.flights.filter((f) => f.key !== key) })),
}))

let flightSeq = 0

/** Max icons per flight (and per launch across all targets). */
const CAP = 16
/** One icon's travel time. */
const FLY_MS = 1050
/** Min/max stagger between icons — tuned so 10 gifts read as a stream. */
const STAGGER_MIN_MS = 85
const STAGGER_MAX_MS = 240

function seatPoint(userId?: string | null): Point | null {
  if (!userId || typeof document === 'undefined') return null
  try {
    const el = document.querySelector(`[data-room-seat="${CSS.escape(userId)}"]`)
    const r = el?.getBoundingClientRect()
    if (!r || r.width === 0) return null
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  } catch {
    return null
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Launch the sender → receiver fly animation. Call from any send surface —
 * DOM seats are resolved live; missing seats fall back to sane anchor
 * points so the animation always plays.
 */
export function launchGiftFly(opts: {
  fromUserId?: string | null
  toUserIds: string[]
  icon: string
  iconType?: string | null
  quantity: number
}) {
  if (typeof window === 'undefined' || prefersReducedMotion()) return
  const quantity = Math.max(1, Math.floor(opts.quantity || 1))
  const vw = window.innerWidth
  const vh = window.innerHeight
  const from =
    seatPoint(opts.fromUserId) ?? { x: vw / 2, y: Math.min(vh * 0.78, vh - 120) }
  const targets = opts.toUserIds.length ? opts.toUserIds : [null]

  // Distribute the icon budget across targets (bulk sends fan out).
  const perTarget = Math.max(1, Math.round(CAP / targets.length))

  const { push, remove } = useGiftFlyStore.getState()
  targets.forEach((targetId) => {
    const to = seatPoint(targetId) ?? { x: vw / 2, y: Math.max(vh * 0.3, 110) }
    const count = Math.min(quantity, perTarget)
    const key = ++flightSeq
    push({
      key,
      from,
      to,
      icon: opts.icon,
      iconType: opts.iconType,
      count,
      badge: quantity > count ? quantity : null,
    })
    // Auto-clear once the last icon + burst finished.
    const perStagger = Math.min(STAGGER_MAX_MS, Math.max(STAGGER_MIN_MS, Math.round(1150 / count)))
    const total = count * perStagger + FLY_MS + 900
    setTimeout(() => remove(key), total)
  })
}

function FlightGroup({ f }: { f: GiftFlight }) {
  const dx = f.to.x - f.from.x
  const dy = f.to.y - f.from.y
  const dist = Math.hypot(dx, dy)
  const arc = Math.min(170, Math.max(56, dist * 0.22))
  const perStagger = Math.min(STAGGER_MAX_MS, Math.max(STAGGER_MIN_MS, Math.round(1150 / f.count)))

  return (
    <>
      {Array.from({ length: f.count }).map((_, i) => {
        const isLast = i === f.count - 1
        const delay = (i * perStagger) / 1000
        return (
          <motion.div
            key={`${f.key}-${i}`}
            initial={false}
            animate={{
              x: [f.from.x, (f.from.x + f.to.x) / 2, f.to.x],
              y: [f.from.y, Math.min(f.from.y, f.to.y) - arc, f.to.y],
              scale: [0.35, 1.08, 0.9, 0.62],
              rotate: [0, 9, -7, 0],
              opacity: [0, 1, 1, 1, 0.9],
            }}
            transition={{ duration: FLY_MS / 1000, delay, ease: 'easeInOut', times: [0, 0.42, 0.78, 0.93, 1] }}
            style={{ position: 'fixed', left: 0, top: 0, zIndex: 234, pointerEvents: 'none' }}
            className="qk-gift-fly-icon"
          >
            <span className="block drop-shadow-[0_0_10px_rgba(255,215,0,0.75)]">
              <GiftIcon
                icon={f.icon}
                iconType={f.iconType}
                className="h-8 w-8 text-[26px]"
                imgClassName="h-8 w-8"
              />
            </span>
            {isLast && f.badge != null && (
              <motion.span
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: delay + FLY_MS / 1000 * 0.55, type: 'spring', stiffness: 380, damping: 18 }}
                className="absolute -top-1.5 -right-6 px-1.5 py-0.5 rounded-full text-[10px] font-black text-[#3a2a00] bg-[var(--qk-gold,#ffd60a)] shadow-md whitespace-nowrap"
              >
                ×{f.badge.toLocaleString('en-US')}
              </motion.span>
            )}
          </motion.div>
        )
      })}

      {/* Arrival burst — glow ring + sparkle at the receiver's seat,
          fired when the last icon lands. */}
      <motion.div
        key={`${f.key}-burst`}
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: [0.4, 1, 1.75], opacity: [0, 0.95, 0] }}
        transition={{
          duration: 0.75,
          delay: ((f.count - 1) * perStagger + FLY_MS * 0.82) / 1000,
          ease: 'easeOut',
        }}
        style={{
          position: 'fixed',
          left: f.to.x,
          top: f.to.y,
          zIndex: 233,
          pointerEvents: 'none',
          translate: '-50% -50%',
          width: 58,
          height: 58,
          borderRadius: '50%',
          border: '2.5px solid var(--qk-gold, #ffd60a)',
          boxShadow: '0 0 26px 6px rgba(255, 214, 10, 0.55)',
        }}
        aria-hidden
      />
      <motion.span
        key={`${f.key}-spark`}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.25, 1], opacity: [0, 1, 0] }}
        transition={{
          duration: 0.8,
          delay: ((f.count - 1) * perStagger + FLY_MS * 0.86) / 1000,
          ease: 'easeOut',
        }}
        style={{
          position: 'fixed',
          left: f.to.x,
          top: f.to.y,
          zIndex: 233,
          pointerEvents: 'none',
          translate: '-50% -50%',
          fontSize: 24,
        }}
        aria-hidden
      >
        ✨
      </motion.span>
    </>
  )
}

/** Render ONCE (AppRoot) — an inert overlay that only paints active flights. */
export function GiftFlyLayer() {
  const flights = useGiftFlyStore((s) => s.flights)
  if (!flights.length) return null
  return (
    <div className="fixed inset-0 pointer-events-none" aria-hidden>
      {flights.map((f) => (
        <FlightGroup key={f.key} f={f} />
      ))}
    </div>
  )
}
