// Quicky — See Who Liked You (Premium) per PRD §6.1
// GET /api/quicky/likes-you  -> for free users: returns blurred previews; for premium: full list
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Find all likes FROM others TO me that haven't been matched yet (or already matched, still show)
  const likes = await db.swipe.findMany({
    where: {
      toUserId: me.id,
      type: { in: ['like', 'superlike'] },
    },
    include: {
      fromUser: { include: { photos: { orderBy: { position: 'asc' } } } },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Filter out: users I've already passed on (we don't show as likes-you)
  const myPasses = await db.swipe.findMany({
    where: { fromUserId: me.id, type: 'pass' },
    select: { toUserId: true },
  })
  const passedIds = new Set(myPasses.map((s) => s.toUserId))

  const items = likes
    .filter((l) => !passedIds.has(l.fromUserId))
    .map((l) => {
      const u = l.fromUser
      const photo = u.photos[0]?.url ?? null
      return {
        id: l.id,
        fromUserId: u.id,
        name: u.name,
        age: u.age,
        isPremium: me.isPremium, // reveal only if premium
        photo: me.isPremium ? photo : null,
        superLike: l.type === 'superlike',
        createdAt: l.createdAt,
      }
    })

  return NextResponse.json({
    likes: items,
    isPremium: me.isPremium,
    lockedCount: me.isPremium ? 0 : items.length,
  })
}
