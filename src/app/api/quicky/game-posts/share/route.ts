// Quicky — share a generated game post to the Community feed
// POST /api/quicky/game-posts/share  { sessionId }
// Creates the caller's CommunityPost from their GamePost. If the partner
// already shared the same session, both posts become mutual (coOwnerId set
// on both) so both owners are shown.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const sessionId = String(body?.sessionId ?? '')
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const session = await db.gameSession.findUnique({ where: { id: sessionId } })
  if (!session || (session.userAId !== me.id && session.userBId !== me.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const gamePost = await db.gamePost.findUnique({
    where: { sessionId_userId: { sessionId, userId: me.id } },
  })
  if (!gamePost) return NextResponse.json({ error: 'No post generated for this game' }, { status: 404 })

  if (gamePost.shared && gamePost.postId) {
    return NextResponse.json({ ok: true, postId: gamePost.postId, alreadyShared: true })
  }

  const partnerId = session.userAId === me.id ? session.userBId : session.userAId

  // Mutual detection: did the partner already publish their copy of this game?
  const partnerPost = await db.communityPost.findFirst({
    where: { gameSessionId: sessionId, userId: partnerId },
    select: { id: true },
  })

  const post = await db.communityPost.create({
    data: {
      userId: me.id,
      coOwnerId: partnerPost ? partnerId : null,
      mediaUrl: null,
      mediaType: 'image',
      caption: null,
      gameType: gamePost.gameType,
      gameTitle: gamePost.title,
      gameBody: gamePost.body,
      emoji: gamePost.emoji,
      gameSessionId: sessionId,
    },
  })

  if (partnerPost) {
    // Upgrade the partner's post to a mutual post too
    await db.communityPost.update({
      where: { id: partnerPost.id },
      data: { coOwnerId: me.id },
    })
  }

  await db.gamePost.update({
    where: { id: gamePost.id },
    data: { shared: true, postId: post.id },
  })

  return NextResponse.json({ ok: true, postId: post.id, mutual: !!partnerPost })
}
