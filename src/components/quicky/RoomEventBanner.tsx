'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

// RoomEventBanner — glossy event strip above the stage (realm PRD §14-§17).
// ONE reusable banner with an EVENT QUEUE:
//   · every event shows 5s, then a SLOW crossfade (~500ms out/in) to the
//     next — the component is never recreated, only its content swaps
//   · gift multiplier events are HIGH PRIORITY (they change earning
//     potential) and render first in the rotation
//   · the multiplier row shows "⚡ N× time — Send gifts and earn more
//     points — HH:MM:SS", counted down from the SERVER expiresAt (the
//     client tick is cosmetic — server state stays authoritative §15)
//   · when a multiplier expires (remaining ≤ 0) it vanishes IMMEDIATELY
//     and the banner falls back to the other events (or disappears)

export type RoomEvent = {
  title: string
  emoji: string
  tag?: string
  background?: string
  expiresAt: string // ISO date
  /** 'multiplier' renders the §14 spec (N× TIME + HH:MM:SS countdown). */
  kind?: 'multiplier' | 'realm' | 'generic'
  sub?: string
}

/** Display duration per event (§16) + slow fade (§16 recommended ~500ms). */
const DISPLAY_MS = 5000
const FADE_MS = 0.5

function formatHMS(ms: number): string {
  if (ms <= 0) return '00:00:00'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '00h 00m'
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`
}

/** Multiplier + realm events expire live: dead rows drop out of the queue. */
function isLive(ev: RoomEvent, now: number): boolean {
  return new Date(ev.expiresAt).getTime() - now > 0
}

export function RoomEventBanner({ event, events }: { event?: RoomEvent; events?: RoomEvent[] }) {
  // Back-compat: single `event` prop rides the same rotation queue.
  const queue = useMemo<RoomEvent[]>(() => {
    const list = events && events.length > 0 ? events : event ? [event] : []
    // §17 — multiplier first, then realm, then generic.
    const weight = (e: RoomEvent) => (e.kind === 'multiplier' ? 0 : e.kind === 'realm' ? 1 : 2)
    return [...list].sort((a, b) => weight(a) - weight(b))
  }, [events, event])

  const [now, setNow] = useState(() => Date.now())
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const live = useMemo(() => queue.filter((e) => isLive(e, now)), [queue, now])
  // Derived (no effect needed): clamp the rotation pointer into the live
  // queue whenever events expire out of it.
  const safeIndex = live.length === 0 ? 0 : index % live.length

  // §16 — advance every 5s (only when more than one live event).
  useEffect(() => {
    if (live.length <= 1) return
    const id = setInterval(() => {
      setIndex((i) => i + 1)
    }, DISPLAY_MS)
    return () => clearInterval(id)
  }, [live.length])

  if (live.length === 0) return null
  const ev = live[safeIndex]
  const remaining = new Date(ev.expiresAt).getTime() - now
  const isMultiplier = ev.kind === 'multiplier'

  return (
    <div className="sbr-banner-wrap" data-testid="room-event-banner">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${ev.kind ?? 'generic'}-${ev.title}-${safeIndex}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: FADE_MS, ease: 'easeInOut' }}
          className="sbr-banner"
          style={ev.background ? { background: ev.background } : undefined}
        >
          <span className="sbr-banner-title">
            <span aria-hidden>{ev.emoji}</span>
            {isMultiplier ? (
              <>
                <span className="sbr-banner-mult">{ev.title}</span>
                <span className="sbr-banner-multsub">Send gifts and earn more points</span>
              </>
            ) : (
              <>
                {ev.title}
                {ev.tag && <span className="sbr-banner-tag">{ev.tag}</span>}
                {ev.sub && <span className="sbr-banner-multsub">{ev.sub}</span>}
              </>
            )}
          </span>
          <span className="sbr-banner-timer" suppressHydrationWarning>
            ⏱ {isMultiplier ? formatHMS(remaining) : formatRemaining(remaining)}
          </span>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** Default room event: "Hot Festival" ending at midnight, local time. */
export function tonightEvent(): RoomEvent {
  const end = new Date()
  end.setHours(24, 0, 0, 0)
  return { title: 'Hot Festival', emoji: '🔥', tag: 'X2 Hearts', expiresAt: end.toISOString() }
}
