// Quicky — GIFT MULTIPLIER SERVICE (realm PRD §9-§13, §18, §49)
//
// Admin-configured temporary N× Realm-Point events. The multiplier is
// ALWAYS derived server-side from the event window + server time:
//   startsAt <= now < expiresAt → event.multiplier
//   otherwise                    → 1 (the permanent fallback, §12)
// The server transaction timestamp decides (§49) — a gift at 14:59:59 uses
// 2×, one at 15:00:00 uses 1×. No client value is ever trusted (§18).
//
// TWO gift multiplier events must never overlap (§13) — creation validates
// the window against every non-cancelled future/active event so the
// effective multiplier stays deterministic (never 2× × 3×).

import { db } from '@/lib/db'

export type GiftMultiplierEvent = {
  id: string
  name: string
  multiplier: number
  startsAt: Date
  expiresAt: Date
  status: string
}

/** PRD §10 — integer only, minimum 2; 100 is the system-safe maximum. */
export const MULTIPLIER_MIN = 2
export const MULTIPLIER_MAX = 100
/** PRD §10 — events may last at most 7 days. */
export const MAX_EVENT_DURATION_MS = 7 * 24 * 60 * 60 * 1000
/** PRD §10 suggested duration options (hours). */
export const EVENT_DURATION_HOURS = [1, 2, 6, 12, 24, 48, 72, 96, 120, 144, 168] as const

export type ActiveMultiplier = {
  multiplier: number
  eventId: string | null
  eventName: string | null
  startsAt: Date | null
  expiresAt: Date | null
}

/**
 * The single server-side source of truth for "what multiplier applies to a
 * gift happening RIGHT NOW". Lazily transitions SCHEDULED→ACTIVE and
 * ACTIVE→EXPIRED so the persisted lifecycle follows the derived truth
 * (§11: at expiry giftMultiplier returns to 1 with no manual reset).
 */
export async function getActiveGiftMultiplier(): Promise<ActiveMultiplier> {
  const now = new Date()

  // Lifecycle housekeeping (cheap, idempotent updateMany — no per-row reads).
  await db.giftMultiplierEvent
    .updateMany({
      where: { status: 'SCHEDULED', startsAt: { lte: now }, expiresAt: { gt: now } },
      data: { status: 'ACTIVE' },
    })
    .catch(() => {})
  await db.giftMultiplierEvent
    .updateMany({
      where: { status: { in: ['SCHEDULED', 'ACTIVE'] }, expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    })
    .catch(() => {})

  // The effective event: window open right now. Multiple rows can never
  // overlap (creation-time validation) — take the newest as a safety net.
  const ev = await db.giftMultiplierEvent.findFirst({
    where: {
      status: { notIn: ['CANCELLED', 'EXPIRED'] },
      startsAt: { lte: now },
      expiresAt: { gt: now },
    },
    orderBy: { expiresAt: 'desc' },
  }).catch(() => null)

  if (!ev) return { multiplier: 1, eventId: null, eventName: null, startsAt: null, expiresAt: null }
  return { multiplier: ev.multiplier, eventId: ev.id, eventName: ev.name, startsAt: ev.startsAt, expiresAt: ev.expiresAt }
}

export async function listGiftMultiplierEvents(): Promise<GiftMultiplierEvent[]> {
  return db.giftMultiplierEvent.findMany({ orderBy: { startsAt: 'desc' }, take: 100 })
}

export type CreateMultiplierInput = {
  name: string
  multiplier: number
  startsAt: Date
  durationMs: number
  createdBy?: string
}

export type CreateMultiplierResult =
  | { ok: true; event: GiftMultiplierEvent }
  | { ok: false; error: 'invalid_name' | 'invalid_multiplier' | 'invalid_duration' | 'invalid_start' | 'overlap'; message: string }

/**
 * Create + activate/schedule a multiplier event with FULL validation:
 * integer 2..100, duration 1h..7d, and NO overlap with any live/upcoming
 * non-cancelled event (§13). Rejections return a human-readable message the
 * admin screen shows directly.
 */
export async function createGiftMultiplierEvent(input: CreateMultiplierInput): Promise<CreateMultiplierResult> {
  const name = (input.name ?? '').trim()
  if (!name || name.length > 80) return { ok: false, error: 'invalid_name', message: 'Event name is required (max 80 characters).' }

  const m = Number(input.multiplier)
  if (!Number.isInteger(m) || m < MULTIPLIER_MIN || m > MULTIPLIER_MAX) {
    return { ok: false, error: 'invalid_multiplier', message: `Multiplier must be a whole number between ${MULTIPLIER_MIN} and ${MULTIPLIER_MAX}.` }
  }

  const durationMs = Math.floor(Number(input.durationMs))
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_EVENT_DURATION_MS) {
    return { ok: false, error: 'invalid_duration', message: 'Duration must be between 1 hour and 7 days.' }
  }

  const startsAt = new Date(input.startsAt)
  if (Number.isNaN(startsAt.getTime())) return { ok: false, error: 'invalid_start', message: 'Invalid start time.' }

  const expiresAt = new Date(startsAt.getTime() + durationMs)

  // §13 — overlap guard: any non-cancelled, non-expired event whose window
  // intersects the new one blocks creation (deterministic multiplier).
  const start = startsAt
  const overlapping = await db.giftMultiplierEvent.findFirst({
    where: {
      status: { notIn: ['CANCELLED', 'EXPIRED'] },
      AND: [{ startsAt: { lt: expiresAt } }, { expiresAt: { gt: start } }],
    },
  })
  if (overlapping) {
    return {
      ok: false,
      error: 'overlap',
      message: 'Another gift multiplier event is already active during this period.',
    }
  }

  const event = await db.giftMultiplierEvent.create({
    data: {
      name,
      multiplier: m,
      startsAt,
      expiresAt,
      // Derived lifecycle (§11): already-running events start ACTIVE.
      status: startsAt.getTime() <= Date.now() ? 'ACTIVE' : 'SCHEDULED',
      createdBy: input.createdBy ?? null,
    },
  })
  return { ok: true, event }
}

/** Cancel a scheduled/active event (admin action, §51). Idempotent. */
export async function cancelGiftMultiplierEvent(id: string): Promise<boolean> {
  const res = await db.giftMultiplierEvent.updateMany({
    where: { id, status: { in: ['SCHEDULED', 'ACTIVE', 'DRAFT'] } },
    data: { status: 'CANCELLED' },
  })
  return res.count > 0
}

/** Delete is limited to CANCELLED/EXPIRED rows (historical reporting §51). */
export async function deleteGiftMultiplierEvent(id: string): Promise<boolean> {
  const res = await db.giftMultiplierEvent.deleteMany({ where: { id, status: { in: ['CANCELLED', 'EXPIRED'] } } })
  return res.count > 0
}
