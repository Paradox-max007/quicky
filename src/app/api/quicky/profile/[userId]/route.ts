// Quicky — public profile view
// GET /api/quicky/profile/[userId]
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { userId } = await ctx.params

  const u = await db.user.findUnique({
    where: { id: userId },
    include: { photos: { orderBy: { position: 'asc' } } },
  })
  if (!u) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Check if there's an active mutual match between viewer and profile owner
  const mutualMatch = me.id !== userId
    ? await db.match.findFirst({
        where: {
          status: 'active',
          OR: [
            { userAId: me.id, userBId: userId },
            { userAId: userId, userBId: me.id },
          ],
        },
      })
    : true // viewing own profile — see everything

  // Filter private photos unless mutual match or own profile
  const photos = u.photos.filter((p) => !p.isPrivate || mutualMatch)

  // Has this person already liked the viewer? (enables "like back")
  const theyLikedMe =
    me.id !== userId
      ? await db.swipe.findFirst({
          where: { fromUserId: userId, toUserId: me.id, type: { in: ['like', 'superlike'] } },
        })
      : null

  // Posts grid (own + mutual game posts), Instagram-style
  const posts = await db.communityPost.findMany({
    where: { OR: [{ userId }, { coOwnerId: userId }] },
    orderBy: { createdAt: 'desc' },
    take: 24,
    select: {
      id: true,
      mediaUrl: true,
      mediaType: true,
      gameType: true,
      gameTitle: true,
      emoji: true,
      caption: true,
      createdAt: true,
    },
  })

  return NextResponse.json({
    profile: {
      id: u.id,
      name: u.name,
      age: u.age,
      gender: u.gender,
      lookingFor: u.lookingFor,
      bio: u.bio,
      city: u.city,
      interests: u.interests ? JSON.parse(u.interests) : [],
      prompts: u.prompts ? JSON.parse(u.prompts) : [],
      photos: photos.map((p) => ({ id: p.id, url: p.url, isPrimary: p.isPrimary, isPrivate: p.isPrivate })),
      hasPrivatePhotos: u.photos.some((p) => p.isPrivate) && !mutualMatch,
      isPremium: u.isPremium,
      isVerified: u.isVerified,
      quickyScore: u.quickyScore,
      posts,
      postCount: posts.length,
    },
    isMe: me.id === u.id,
    relationship: {
      hasMatch: !!mutualMatch,
      matchId: mutualMatch && mutualMatch !== true ? mutualMatch.id : null,
      theyLikedMe: !!theyLikedMe,
      superLike: theyLikedMe?.type === 'superlike',
    },
  })
}
