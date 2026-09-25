// Quicky — MONTHLY SEASON SERVICE (crate-pass PRD)
//
// A calendar-month competitive window that sits NEXT TO the realm system:
//   · the ❤ room chip shows the viewer's points for the ACTIVE season
//   · points are earned wherever realm points are earned (the canonical
//     gift-award path) — boosted by any RUNNING season event
//   · when the month rolls over a NEW Season row becomes active and every
//     user starts at 0 (per-season history is preserved in UserSeason rows)
//
// Auto-provisioning: the first status/award touch of a month with no active
// Season row creates one (name = month + year, calendar-month window). Admins
// can then rename it, attach an image, seasonal gifts and season events from
// the console — nothing breaks if they don't.
//
// Distinct from realm-seasons.ts (RealmSeason = the realm-LADDER season).

import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

/** In-process cache for the active season row (60s — month windows are slow). */
type SeasonCache = { at: number; season: ActiveSeasonRow | null }
let cache: SeasonCache | null = null
const CACHE_MS = 60_000

export type ActiveSeasonRow = {
  id: string
  name: string
  imageUrl: string | null
  startsAt: Date
  endsAt: Date
}

/** UTC calendar-month window [start, nextMonthStart) for a given date. */
function monthWindow(now = new Date()): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const endsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { startsAt, endsAt }
}

function defaultSeasonName(now = new Date()): string {
  const month = now.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
  return `Season of ${month} ${now.getUTCFullYear()}`
}

/**
 * The ACTIVE monthly season — the row whose window contains now AND whose
 * isActive flag is on. Auto-creates the current calendar month when nothing
 * is active (idempotent — a unique-free table, guarded by the window query).
 */
export async function getOrCreateActiveSeason(): Promise<ActiveSeasonRow | null> {
  const now = new Date()
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.season

  let season = await db.season
    .findFirst({
      where: { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: { startsAt: 'desc' },
      select: { id: true, name: true, imageUrl: true, startsAt: true, endsAt: true },
    })
    .catch(() => null)

  if (!season) {
    // No active window → provision the current month. If an admin already
    // created a row whose window CONTAINS now (inactive or mislabeled),
    // reactivate THAT row (window untouched); else create the default
    // calendar-month season.
    const { startsAt, endsAt } = monthWindow(now)
    const existing = await db.season
      .findFirst({ where: { startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { startsAt: 'asc' } })
      .catch(() => null)
    season = existing
      ? await db.season
          .update({ where: { id: existing.id }, data: { isActive: true }, select: { id: true, name: true, imageUrl: true, startsAt: true, endsAt: true } })
          .catch(() => null)
      : await db.season
          .create({ data: { name: defaultSeasonName(now), startsAt, endsAt, isActive: true }, select: { id: true, name: true, imageUrl: true, startsAt: true, endsAt: true } })
          .catch(() => null)
  }

  cache = { at: Date.now(), season }
  return season
}

/** Active season-event boost for SEASON points (max multiplier, default 1). */
export async function seasonEventBoost(seasonId: string | null | undefined): Promise<number> {
  if (!seasonId) return 1
  const now = new Date()
  const events = await db.seasonEvent
    .findMany({
      where: { seasonId, startsAt: { lte: now }, endsAt: { gt: now } },
      select: { multiplier: true },
    })
    .catch(() => [] as { multiplier: number }[])
  const boost = events.reduce((m, e) => Math.max(m, Math.max(1, Math.floor(e.multiplier) || 1)), 1)
  return boost
}

export type SeasonAwardEntry = { userId: string; points: number }

/**
 * Award season points (the ❤ chip) — upsert-increment on UserSeason, boosted
 * by the active season event. Accepts the OPEN GIFT TRANSACTION client so the
 * realm + season counters commit atomically together (never a season row
 * without its realm ledger sibling).
 */
export async function awardSeasonPoints(
  tx: Prisma.TransactionClient,
  season: { id: string } | null,
  boost: number,
  entries: SeasonAwardEntry[]
): Promise<void> {
  if (!season || entries.length === 0) return
  const mult = Math.max(1, Math.floor(boost) || 1)
  for (const { userId, points } of entries) {
    if (!points || points <= 0) continue
    const boosted = points * mult
    await tx.userSeason
      .upsert({
        where: { userId_seasonId: { userId, seasonId: season.id } },
        create: { userId, seasonId: season.id, points: boosted },
        update: { points: { increment: boosted } },
      })
      .catch(() => {})
  }
}

export type SeasonEventInfo = {
  id: string
  name: string
  emoji: string
  description: string | null
  multiplier: number
  startsAt: string
  endsAt: string
  running: boolean
}

export type SeasonalGiftInfo = {
  itemId: string
  name: string
  emoji: string
  iconType: string
  iconValue: string | null
  coinPrice: number
}

export type SeasonStatus = {
  season: { id: string; name: string; imageUrl: string | null; endsAt: string; daysLeft: number } | null
  points: number
  boost: number
  events: SeasonEventInfo[]
  gifts: SeasonalGiftInfo[]
}

/** Full viewer-facing season status (status screen + ❤ chip refresh). */
export async function getSeasonStatus(userId: string): Promise<SeasonStatus> {
  const season = await getOrCreateActiveSeason()
  if (!season) {
    return { season: null, points: 0, boost: 1, events: [], gifts: [] }
  }

  const [userSeason, boost, events, giftRows] = await Promise.all([
    db.userSeason.findUnique({
      where: { userId_seasonId: { userId, seasonId: season.id } },
      select: { points: true },
    }),
    seasonEventBoost(season.id),
    db.seasonEvent.findMany({ where: { seasonId: season.id }, orderBy: { startsAt: 'asc' } }),
    db.seasonGift.findMany({ where: { seasonId: season.id }, orderBy: { sortOrder: 'asc' } }),
  ])

  const items = giftRows.length
    ? await db.gameItem
        .findMany({
          where: { id: { in: giftRows.map((g) => g.itemId) } },
          select: { id: true, name: true, emoji: true, iconType: true, iconValue: true, coinPrice: true },
        })
        .catch(() => [])
    : []

  const now = Date.now()
  const daysLeft = Math.max(0, Math.ceil((season.endsAt.getTime() - now) / 86_400_000))

  return {
    season: {
      id: season.id,
      name: season.name,
      imageUrl: season.imageUrl,
      endsAt: season.endsAt.toISOString(),
      daysLeft,
    },
    points: userSeason?.points ?? 0,
    boost,
    events: events.map((e) => ({
      id: e.id,
      name: e.name,
      emoji: e.emoji,
      description: e.description,
      multiplier: e.multiplier,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      running: e.startsAt.getTime() <= now && e.endsAt.getTime() > now,
    })),
    gifts: items.map((it) => ({
      itemId: it.id,
      name: it.name,
      emoji: it.emoji,
      iconType: it.iconType,
      iconValue: it.iconValue,
      coinPrice: it.coinPrice,
    })),
  }
}
