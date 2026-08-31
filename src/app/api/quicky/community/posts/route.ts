// Quicky — Community feed (Instagram-style posts)
// GET  /api/quicky/community/posts          → latest posts
// POST /api/quicky/community/posts          → create a post { mediaUrl, mediaType, caption?, filter? }
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { excludedUserIds, authorSummary, AUTHOR_INCLUDE } from '@/lib/quicky/community-server'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hidden = await excludedUserIds(me.id)

  const posts = await db.communityPost.findMany({
    where: { userId: { notIn: hidden.length ? hidden : undefined } },
    orderBy: { createdAt: 'desc' },
    take: 60,
    include: {
      user: AUTHOR_INCLUDE,
      coOwner: AUTHOR_INCLUDE,
      _count: { select: { likes: true, comments: true } },
      likes: { where: { userId: me.id }, select: { id: true } },
    },
  })

  return NextResponse.json({
    posts: posts.map((p) => ({
      id: p.id,
      caption: p.caption,
      mediaUrl: p.mediaUrl,
      mediaType: p.mediaType,
      filter: p.filter,
      createdAt: p.createdAt,
      author: authorSummary(p.user),
      coOwner: p.coOwner ? authorSummary(p.coOwner) : null,
      gameType: p.gameType,
      gameTitle: p.gameTitle,
      gameBody: p.gameBody,
      emoji: p.emoji,
      likeCount: p._count.likes,
      commentCount: p._count.comments,
      likedByMe: p.likes.length > 0,
    })),
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const mediaUrl = typeof body?.mediaUrl === 'string' ? body.mediaUrl : ''
  const mediaType = body?.mediaType === 'video' ? 'video' : 'image'
  const caption = typeof body?.caption === 'string' ? body.caption.slice(0, 500).trim() : ''
  const filter = typeof body?.filter === 'string' && body.filter !== 'none' ? body.filter.slice(0, 32) : null

  if (!mediaUrl || (!mediaUrl.startsWith('/uploads/') && !mediaUrl.startsWith('http'))) {
    return NextResponse.json({ error: 'Media is required' }, { status: 400 })
  }

  const post = await db.communityPost.create({
    data: {
      userId: me.id,
      caption: caption || null,
      mediaUrl,
      mediaType,
      filter,
    },
  })

  return NextResponse.json({ ok: true, postId: post.id })
}
