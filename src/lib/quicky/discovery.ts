// Quicky — discovery ranking per PRD §7
import { db } from '@/lib/db'
import { QUICKY } from './constants'

export type DiscoveryCandidate = {
  id: string
  name: string | null
  age: number | null
  bio: string | null
  city: string | null
  interests: string[]
  photos: { id: string; url: string }[]
  isVerified: boolean
  isPremium: boolean
  quickyScore: number
  // visibility score (higher = shown first)
  visibility: number
  // computed for display
  distanceKm: number | null
}

/**
 * Build the discovery queue for a user.
 * Excludes: self, already-swiped, blocked users, users outside gender preference.
 *
 * Per PRD §7: Premium candidates get higher visibility multiplier. Verified
 * users get a small bonus. New Premium users get a temporary "New & Boosted"
 * placement. Interleaves Premium candidates at higher frequency while still
 * showing organic free users to keep marketplace healthy.
 */
export async function buildDiscoveryQueue(opts: {
  userId: string
  limit?: number
}): Promise<DiscoveryCandidate[]> {
  const me = await db.user.findUnique({ where: { id: opts.userId } })
  if (!me) return []

  // gender preference filter
  const lookingFor = me.lookingFor ?? 'everyone'

  // Get all user IDs I've already swiped on
  const swiped = await db.swipe.findMany({
    where: { fromUserId: me.id },
    select: { toUserId: true },
  })
  const swipedIds = new Set(swiped.map((s) => s.toUserId))

  // Get blocks (either direction)
  const blocks = await db.block.findMany({
    where: { OR: [{ blockerId: me.id }, { blockedId: me.id }] },
  })
  const blockedIds = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]))

  // Pull all candidate users
  const candidates = await db.user.findMany({
    where: {
      id: { not: me.id },
      onboardedAt: { not: null },
      name: { not: null },
      age: { not: null },
      AND: [
        // gender preference
        lookingFor === 'men'
          ? { gender: 'male' }
          : lookingFor === 'women'
          ? { gender: 'female' }
          : {},
      ],
    },
    include: { photos: { orderBy: { position: 'asc' } } },
    take: 200,
  })

  const myInterests = me.interests ? JSON.parse(me.interests) : []

  const scored = candidates
    .filter((u) => !swipedIds.has(u.id) && !blockedIds.has(u.id))
    .map((u) => {
      const photoCount = u.photos.length
      const theirInterests: string[] = u.interests ? JSON.parse(u.interests) : []
      const overlap = theirInterests.filter((t) => myInterests.includes(t)).length
      const sameCity = me.city && u.city && me.city === u.city
      const isNew =
        u.isPremium &&
        u.createdAt.getTime() > Date.now() - QUICKY.ranking.newBoostWindowHours * 3600 * 1000

      let score = 1
      // base
      score *= 1.0
      // premium multiplier
      if (u.isPremium) score *= QUICKY.ranking.premiumMultiplier
      // new boost
      if (isNew) score *= QUICKY.ranking.newBoostMultiplier
      // verified bonus
      if (u.isVerified) score *= QUICKY.ranking.verifiedBonus
      // photo count bonus
      score *= Math.pow(QUICKY.ranking.photoCountBonus, Math.min(photoCount, 6))
      // interest overlap bonus
      if (overlap > 0) score *= 1 + 0.1 * overlap
      // same city
      if (sameCity) score *= QUICKY.ranking.sameCityBonus

      // small random jitter so order isn't deterministic
      score *= 0.9 + Math.random() * 0.2

      const distance = sameCity ? 1 + Math.random() * 8 : 10 + Math.random() * 80

      return {
        id: u.id,
        name: u.name,
        age: u.age,
        bio: u.bio,
        city: u.city,
        interests: theirInterests,
        // In discovery, private photos are hidden (no mutual match yet)
        photos: u.photos.filter((p) => !p.isPrivate).map((p) => ({ id: p.id, url: p.url })),
        isVerified: u.isVerified,
        isPremium: u.isPremium,
        quickyScore: u.quickyScore,
        visibility: score,
        distanceKm: Math.round(distance),
      } as DiscoveryCandidate
    })

  // Sort by visibility descending (highest first)
  scored.sort((a, b) => b.visibility - a.visibility)

  // Interleave: ensure first ~30% of queue has premium candidates prioritized,
  // but still show some free candidates for marketplace health.
  const premium = scored.filter((c) => c.isPremium)
  const free = scored.filter((c) => !c.isPremium)
  const interleaved: DiscoveryCandidate[] = []
  let pi = 0,
    fi = 0
  const total = Math.min(opts.limit ?? 50, scored.length)
  for (let i = 0; i < total; i++) {
    // 60% premium in first half, then taper
    const wantPremium = i < total / 2 ? Math.random() < 0.65 : Math.random() < 0.35
    if (wantPremium && pi < premium.length) {
      interleaved.push(premium[pi++])
    } else if (fi < free.length) {
      interleaved.push(free[fi++])
    } else if (pi < premium.length) {
      interleaved.push(premium[pi++])
    } else {
      break
    }
  }
  return interleaved
}

/**
 * Compute remaining daily like/superlike/quicky limits for a user.
 * Per PRD §5.2, §8.3.
 */
export async function getRemainingLimits(opts: { userId: string; matchId?: string }) {
  const user = await db.user.findUnique({ where: { id: opts.userId } })
  if (!user) return { likes: 0, superLikes: 0, quicky: 0, isPremium: false }

  if (user.isPremium) {
    let quickyLeft = Number.POSITIVE_INFINITY
    if (opts.matchId) {
      // Premium = unlimited but we still cap per match for demo realism
      const sentTodayInMatch = await db.message.count({
        where: {
          matchId: opts.matchId,
          senderId: user.id,
          type: 'quicky',
          createdAt: { gte: new Date(Date.now() - 86400000) },
        },
      })
      quickyLeft = Math.max(0, 50 - sentTodayInMatch)
    }
    return {
      likes: Number.POSITIVE_INFINITY,
      superLikes: QUICKY.premium.superLikesPerDay,
      quicky: quickyLeft,
      isPremium: true,
    }
  }

  // Free tier
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const likesToday = await db.swipe.count({
    where: {
      fromUserId: user.id,
      type: { in: ['like', 'superlike'] },
      createdAt: { gte: todayStart },
    },
  })
  const superLikesToday = await db.swipe.count({
    where: {
      fromUserId: user.id,
      type: 'superlike',
      createdAt: { gte: todayStart },
    },
  })
  let quickyToday = 0
  if (opts.matchId) {
    quickyToday = await db.message.count({
      where: {
        matchId: opts.matchId,
        senderId: user.id,
        type: 'quicky',
        createdAt: { gte: todayStart },
      },
    })
  }
  return {
    likes: Math.max(0, QUICKY.limits.freeLikesPerDay - likesToday),
    superLikes: Math.max(0, QUICKY.limits.freeSuperLikesPerDay - superLikesToday),
    quicky: Math.max(0, QUICKY.limits.freeQuickyPerDay - quickyToday),
    isPremium: false,
  }
}
