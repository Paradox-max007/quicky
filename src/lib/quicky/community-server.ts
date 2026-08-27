// Quicky — shared helpers for community (posts / rolls) API routes
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

// Ids of everyone I blocked or who blocked me — their content is hidden from me.
export async function excludedUserIds(userId: string): Promise<string[]> {
  const blocks = await db.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  })
  return blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId))
}

// Compact author card attached to every post/comment/roll
export function authorSummary(u: {
  id: string
  name: string | null
  isPremium: boolean
  isVerified: boolean
  photos?: { url: string; isPrimary: boolean; isPrivate: boolean; position: number }[]
}) {
  const photo = (u.photos ?? [])
    .filter((p) => !p.isPrivate)
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.position - b.position)[0]
  return {
    id: u.id,
    name: u.name,
    avatar: photo?.url ?? null,
    isPremium: u.isPremium,
    isVerified: u.isVerified,
  }
}

export const AUTHOR_INCLUDE = {
  include: {
    photos: {
      orderBy: [{ position: 'asc' as const }],
      select: { url: true, isPrimary: true, isPrivate: true, position: true },
    },
  },
} satisfies Prisma.UserDefaultArgs

// True when there's an active match between two users
export async function hasMutualMatch(a: string, b: string): Promise<boolean> {
  if (a === b) return true
  const m = await db.match.findFirst({
    where: {
      status: 'active',
      OR: [
        { userAId: a, userBId: b },
        { userAId: b, userBId: a },
      ],
    },
    select: { id: true },
  })
  return !!m
}
