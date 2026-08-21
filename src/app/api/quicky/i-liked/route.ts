// Quicky — People You Liked
// GET /api/quicky/i-liked  -> list of people the current user has liked/superliked
// Visible to all users (free + premium). No blur.
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Find all my likes/superlikes
  const swipes = await db.swipe.findMany({
    where: {
      fromUserId: me.id,
      type: { in: ['like', 'superlike'] },
    },
    include: {
      toUser: { include: { photos: { orderBy: { position: 'asc' } } } },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Check which ones are already matches
  const matches = await db.match.findMany({
    where: {
      OR: [{ userAId: me.id }, { userBId: me.id }],
      status: 'active',
    },
    select: { userAId: true, userBId: true },
  })
  const matchedUserIds = new Set(
    matches.flatMap((m) => [m.userAId, m.userBId])
  )

  const items = swipes.map((s) => {
    const u = s.toUser
    return {
      id: s.id,
      toUserId: u.id,
      name: u.name,
      age: u.age,
      city: u.city,
      photo: u.photos[0]?.url ?? null,
      isPremium: u.isPremium,
      isVerified: u.isVerified,
      superLike: s.type === 'superlike',
      isMatch: matchedUserIds.has(u.id),
      createdAt: s.createdAt,
    }
  })

  return NextResponse.json({
    liked: items,
    count: items.length,
  })
}
