// Quicky — public profile view
// GET /api/quicky/profile/[userId]
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { pushNotify } from '@/lib/quicky/push'

// Profile-view push throttle: one "X viewed your profile" notification per
// (viewer → viewed) pair per 30 minutes (in-process map; cheap and good
// enough — every profile GET would otherwise spam on refreshes).
const VIEW_PUSH_COOLDOWN_MS = 30 * 60_000
const viewPushAt = new Map<string, number>()
function shouldPushView(viewerId: string, viewedId: string): boolean {
  const key = `${viewerId}>${viewedId}`
  const now = Date.now()
  const last = viewPushAt.get(key) ?? 0
  if (now - last < VIEW_PUSH_COOLDOWN_MS) return false
  viewPushAt.set(key, now)
  return true
}

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

  // DUAL PROFILE (profile revision): every user has a DATING profile (the
  // classic fields below) and a GAME profile — the permanent lifetime game
  // stats that survive room deletion (spin kiss points, Ludo, gifting).
  // Exposed as profile.gameStats for the Game tab.
  // Block state (refactor PRD §55) — when blocked, BOTH users see each
  // other's profile images as highly blurred.
  const [myBlock, theirBlock] = me.id !== userId
    ? await Promise.all([
        db.block.findUnique({
          where: { blockerId_blockedId: { blockerId: me.id, blockedId: userId } },
        }),
        db.block.findUnique({
          where: { blockerId_blockedId: { blockerId: userId, blockedId: me.id } },
        }),
      ])
    : [null, null]

  // FCM — profile-view notification to the OWNER (gated by their settings,
  // throttled per viewer pair, never on self/block views).
  if (me.id !== userId && !myBlock && !theirBlock && shouldPushView(me.id, userId)) {
    void pushNotify(userId, 'profileView', {
      title: 'Someone viewed your profile \u{1F440}',
      body: `${me.name ?? 'Someone'} checked out your profile.`,
      data: { view: 'profile-view', userId: me.id },
    })
  }

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
      gameStats: {
        gamesPlayed: u.gamesPlayed,
        kissPoints: u.kissPoints,
        kissesGiven: u.kissesGiven,
        ludoWins: u.ludoWins,
        ludoTokensFinished: u.ludoTokensFinished,
        ludoCaptures: u.ludoCaptures,
        giftsSent: u.giftsSentCount,
        giftsReceived: u.giftsReceivedCount,
        coinBalance: me.id === u.id ? u.coinBalance : undefined,
      },
      blocked: !!(myBlock || theirBlock),
      iBlockedThem: !!myBlock,
      theyBlockedMe: !!theirBlock,
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
