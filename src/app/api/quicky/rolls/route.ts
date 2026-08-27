// Quicky — Rolls (ephemeral stories, 24h)
// GET  /api/quicky/rolls   → all active rolls (mine + others), newest first
// POST /api/quicky/rolls   → create { mediaUrl, mediaType, caption?, filter? }
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import {
  excludedUserIds,
  authorSummary,
  AUTHOR_INCLUDE,
  hasMutualMatch,
} from '@/lib/quicky/community-server'

export const dynamic = 'force-dynamic'

const ROLL_TTL_MS = 24 * 60 * 60 * 1000

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hidden = await excludedUserIds(me.id)

  const rolls = await db.roll.findMany({
    where: {
      expiresAt: { gt: new Date() },
      userId: { notIn: hidden.length ? hidden : undefined },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      user: AUTHOR_INCLUDE,
      _count: { select: { likes: true, comments: true } },
      likes: { where: { userId: me.id }, select: { id: true } },
    },
  })

  // Interaction with someone else's roll needs premium or a mutual match —
  // resolve the match set once per author instead of per roll.
  const authorIds = [...new Set(rolls.map((r) => r.userId))]
  const matched = new Set<string>()
  for (const id of authorIds) {
    if (id !== me.id && (await hasMutualMatch(me.id, id))) matched.add(id)
  }

  return NextResponse.json({
    isPremium: me.isPremium,
    rolls: rolls.map((r) => ({
      id: r.id,
      caption: r.caption,
      mediaUrl: r.mediaUrl,
      mediaType: r.mediaType,
      filter: r.filter,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      author: authorSummary(r.user),
      likeCount: r._count.likes,
      commentCount: r._count.comments,
      likedByMe: r.likes.length > 0,
      canInteract: me.isPremium || r.userId === me.id || matched.has(r.userId),
    })),
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const mediaUrl = typeof body?.mediaUrl === 'string' ? body.mediaUrl : ''
  const mediaType = body?.mediaType === 'video' ? 'video' : 'image'
  const caption = typeof body?.caption === 'string' ? body.caption.slice(0, 300).trim() : ''
  const filter = typeof body?.filter === 'string' && body.filter !== 'none' ? body.filter.slice(0, 32) : null

  if (!mediaUrl || (!mediaUrl.startsWith('/uploads/') && !mediaUrl.startsWith('http'))) {
    return NextResponse.json({ error: 'Media is required' }, { status: 400 })
  }

  const roll = await db.roll.create({
    data: {
      userId: me.id,
      caption: caption || null,
      mediaUrl,
      mediaType,
      filter,
      expiresAt: new Date(Date.now() + ROLL_TTL_MS),
    },
  })

  return NextResponse.json({ ok: true, rollId: roll.id })
}
