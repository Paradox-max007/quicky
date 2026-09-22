// Quicky — REALM RANKING + LEADERBOARD (realm PRD §31/§43-§44, §55-§57)
//
// Cohort-scoped standings. The leaderboard query is the authoritative
// server snapshot (§68: reconnect/refresh always fetches it — realtime is
// only the instant nudge). Top-3 rows visually flag promotion QUALIFICATION
// (rank ≤ 3 + threshold), but nobody is "promoted" until settlement
// actually runs (§43: do not mark a player as promoted before settlement).

import { db } from '@/lib/db'
import { ensureRealmBootstrap } from './realm-config'
import { ensureRealmParticipation, settleDueCycles } from './realm-cycle'
import { eligibleForPromotion } from './realm-promotion'
import { getSeason, realmDisplayName } from './realm-seasons'

export type LeaderboardRow = {
  rank: number
  userId: string
  name: string
  avatar: string | null
  cyclePoints: number
  isMe: boolean
  /** Server-computed hint: rank ≤ 3 AND points ≥ threshold (not a promise). */
  qualifies: boolean
}

export type RealmStatus = {
  realm: { level: number; name: string; description: string | null }
  nextRealm: { level: number; name: string } | null
  season: { seasonNumber: number; name: string; description: string | null } | null
  cycle: { id: string; endsAt: string; status: string } | null
  points: number
  threshold: number
  rank: number | null
  cohortSize: number
  lifetimeRealmPoints: number
  leaderboard: LeaderboardRow[]
  /** Unseen settled-cycle result (drives the Realm result screen, §58). */
  pendingResult: {
    cycleId: string
    realmName: string
    rank: number
    points: number
    threshold: number
    promoted: boolean
    rewards: { itemId: string; name: string; emoji: string; quantity: number }[]
  } | null
}

/**
 * Full realm status for the viewer: participation + cohort leaderboard +
 * pending settlement result. Lazily settles due cycles first so the user
 * never sees a stale "active" cycle that already ended (§80).
 */
export async function getRealmStatus(userId: string): Promise<RealmStatus | null> {
  await ensureRealmBootstrap()
  await settleDueCycles().catch(() => {})

  const part = (await ensureRealmParticipation([userId])).get(userId)
  if (!part) return null

  const ur0 = await db.userRealm.findUnique({ where: { userId }, select: { seasonNumber: true } })

  const [ur, def, nextDef, claim, season] = await Promise.all([
    db.userRealm.findUnique({ where: { userId } }),
    db.realmDefinition.findUnique({ where: { level: part.realmLevel } }),
    part.realmLevel < 15 ? db.realmDefinition.findUnique({ where: { level: part.realmLevel + 1 } }) : Promise.resolve(null),
    // Unseen result = newest unclaimed claim row (claimedAt null).
    db.realmRewardClaim.findFirst({
      where: { userId, claimedAt: null },
      orderBy: { grantedAt: 'desc' },
    }),
    getSeason(ur0?.seasonNumber ?? 1),
  ])
  if (!ur) return null

  const cycle = await db.realmCycle.findUnique({ where: { id: part.cycleId } })

  // Cohort standings (§43) — users + first public photo in ONE join-ish pass.
  const members = await db.realmCohortMember.findMany({ where: { cohortId: part.cohortId } })
  const users = await db.user.findMany({
    where: { id: { in: members.map((m) => m.userId) } },
    select: { id: true, name: true, photos: { where: { isPrivate: false }, take: 1, select: { url: true } } },
  })
  const byUser = new Map(users.map((u) => [u.id, u]))
  const threshold = cycle?.threshold ?? def?.promotionThreshold ?? 0

  const rows = members
    .map((m) => {
      const u = byUser.get(m.userId)
      return {
        rank: 0,
        userId: m.userId,
        name: u?.name ?? 'Player',
        avatar: u?.photos[0]?.url ?? null,
        cyclePoints: m.cyclePoints,
        isMe: m.userId === userId,
        qualifies: false,
      }
    })
    .sort((a, b) => {
      if (b.cyclePoints !== a.cyclePoints) return b.cyclePoints - a.cyclePoints
      const ma = members.find((m) => m.userId === a.userId)!
      const mb = members.find((m) => m.userId === b.userId)!
      const at = ma.thresholdReachedAt?.getTime() ?? Number.MAX_SAFE_INTEGER
      const bt = mb.thresholdReachedAt?.getTime() ?? Number.MAX_SAFE_INTEGER
      if (at !== bt) return at - bt
      return a.userId < b.userId ? -1 : 1
    })
    .map((row, i) => ({ ...row, rank: i + 1, qualifies: eligibleForPromotion(i + 1, row.cyclePoints, threshold) }))

  let pendingResult: RealmStatus['pendingResult'] = null
  if (claim) {
    const claimCycle = await db.realmCycle.findUnique({ where: { id: claim.cycleId } })
    // Admin-console PRD — combined reward list: LEGACY items (resolved from
    // the live catalog) + catalog rewards (icon/name embedded in the row).
    const legacy = JSON.parse(claim.rewards || '[]') as { itemId?: string; quantity?: number; rewardId?: string; name?: string; icon?: string; quantity2?: number; level?: number }[]
    const legacyItems = legacy.filter((i) => i.itemId && i.itemId !== 'undefined')
    const catalogItems = legacy.filter((i) => !i.itemId && i.rewardId)
    const resolved = await db.gameItem
      .findMany({ where: { id: { in: legacyItems.map((i) => String(i.itemId)) } }, select: { id: true, name: true, emoji: true, iconType: true, iconValue: true } })
      .then((rows) => {
        const byId = new Map(rows.map((r) => [r.id, r]))
        return legacyItems.map((i) => {
          const g = byId.get(String(i.itemId))
          return { itemId: String(i.itemId), name: g?.name ?? 'Reward', emoji: g ? (g.iconType === 'image' || g.iconType === 'png' ? (g.iconValue ?? g.emoji) : g.emoji) : '🎁', quantity: Number(i.quantity ?? 1) }
        })
      })
      .catch(() => [] as { itemId: string; name: string; emoji: string; quantity: number }[])
    const rewards = [
      ...resolved,
      ...catalogItems.map((i) => ({ itemId: String(i.rewardId), name: String(i.name ?? 'Reward'), emoji: String(i.icon ?? '🎁'), quantity: Number(i.quantity ?? 1) })),
    ]
    const member = members.find((m) => m.userId === userId)
    const claimRealmDef = await db.realmDefinition.findUnique({ where: { level: claimCycle?.realmLevel ?? 1 } })
    pendingResult = {
      cycleId: claim.cycleId,
      realmName: realmDisplayName(claimRealmDef?.name ?? 'Realm', season, claimCycle?.realmLevel ?? 1),
      rank: claim.rank,
      points: claimCycle ? (member?.cyclePoints ?? 0) : 0,
      threshold: claimCycle?.threshold ?? 0,
      promoted: claim.promoted,
      rewards,
    }
  }

  return {
    realm: {
      level: part.realmLevel,
      name: realmDisplayName(def?.name ?? 'The Abyss', season, part.realmLevel),
      description: def?.description ?? null,
    },
    nextRealm: nextDef ? { level: nextDef.level, name: realmDisplayName(nextDef.name, season, nextDef.level) } : null,
    season: season
      ? { seasonNumber: season.seasonNumber, name: season.name, description: season.description }
      : { seasonNumber: ur0?.seasonNumber ?? 1, name: `Season ${ur0?.seasonNumber ?? 1}`, description: null },
    cycle: cycle ? { id: cycle.id, endsAt: cycle.endAt.toISOString(), status: cycle.status } : null,
    points: ur.cyclePoints,
    threshold,
    rank: rows.find((r) => r.isMe)?.rank ?? null,
    cohortSize: rows.length,
    lifetimeRealmPoints: ur.lifetimeRealmPoints,
    leaderboard: rows,
    pendingResult,
  }
}

/** Mark the newest pending result as seen (Realm result screen dismiss). */
export async function markRealmResultSeen(userId: string, cycleId?: string): Promise<boolean> {
  const claim = cycleId
    ? await db.realmRewardClaim.findUnique({ where: { userId_cycleId: { userId, cycleId } } })
    : await db.realmRewardClaim.findFirst({ where: { userId, claimedAt: null }, orderBy: { grantedAt: 'desc' } })
  if (!claim) return false
  await db.realmRewardClaim.update({ where: { id: claim.id }, data: { claimedAt: new Date() } })
  await db.userRealm.update({ where: { userId }, data: { lastResultSeenCycleId: claim.cycleId } }).catch(() => {})
  return true
}

/** Point history for the viewer (§57): newest first, joined with gift meta. */
export async function getRealmPointHistory(userId: string, limit = 50) {
  const rows = await db.realmPointLedger.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(1, limit), 100),
  })
  return rows.map((r) => {
    let meta: Record<string, unknown> = {}
    try {
      meta = JSON.parse(r.metadata ?? '{}')
    } catch {
      meta = {}
    }
    return {
      id: r.id,
      sourceType: r.sourceType,
      basePoints: r.basePoints,
      multiplier: r.multiplier,
      awardedPoints: r.awardedPoints,
      createdAt: r.createdAt.toISOString(),
      itemName: (meta.itemName as string) ?? null,
      itemEmoji: (meta.itemEmoji as string) ?? null,
      multiplierEventName: (r.multiplier > 1 ? `${r.multiplier}× Event` : null) as string | null,
    }
  })
}
