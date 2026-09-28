// Quicky — GIFT AVAILABILITY WINDOW (admin-console PRD §6.1)
// Optional per-gift availability dates: a gift with a window is purchasable /
// sendable only between availableFrom and availableUntil. NULL on either side
// means unbounded (the pre-PRD behavior for every existing gift).
//
// Shared by the public catalogs (gifts hub + room drawer) and the send flows
// so admins schedule limited-time gifts exactly once, everywhere.
import { Prisma } from '@prisma/client'

/** Prisma `where` fragment matching gifts that are live RIGHT NOW. */
export function giftAvailabilityWhere(now: Date = new Date()): Prisma.GameItemWhereInput {
  return {
    AND: [
      { OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] },
      { OR: [{ availableUntil: null }, { availableUntil: { gte: now } }] },
    ],
  }
}

/** True when the row's window (if any) contains `now`. Used on single-row
 * reads (send flows) where a where-clause would silently 400 instead of
 * explaining. Accepts any row shape — missing keys mean "no window". */
export function isGiftAvailable(gift: unknown, now: Date = new Date()): boolean {
  const g = (gift ?? {}) as { availableFrom?: Date | string | null; availableUntil?: Date | string | null }
  const from = g.availableFrom ? new Date(g.availableFrom) : null
  const until = g.availableUntil ? new Date(g.availableUntil) : null
  if (from && !Number.isNaN(from.getTime()) && from.getTime() > now.getTime()) return false
  if (until && !Number.isNaN(until.getTime()) && until.getTime() < now.getTime()) return false
  return true
}

/** Compact human label for admin lists: "from Oct 1", "til Oct 5", "Oct 1 → Oct 5". */
export function giftAvailabilityLabel(
  gift: { availableFrom?: Date | string | null; availableUntil?: Date | string | null }
): string | null {
  const from = gift.availableFrom ? new Date(gift.availableFrom) : null
  const until = gift.availableUntil ? new Date(gift.availableUntil) : null
  if (!from && !until) return null
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (from && until) return `${fmt(from)} → ${fmt(until)}`
  if (from) return `from ${fmt(from)}`
  if (until) return `til ${fmt(until)}`
  return null
}
