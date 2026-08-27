// Quicky — comments on a community post
// GET  /api/quicky/community/posts/[postId]/comments
// POST /api/quicky/community/posts/[postId]/comments { text }
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { authorSummary, AUTHOR_INCLUDE } from '@/lib/quicky/community-server'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { postId } = await ctx.params

  const comments = await db.postComment.findMany({
    where: { postId },
    orderBy: { createdAt: 'asc' },
    take: 200,
    include: { user: AUTHOR_INCLUDE },
  })

  return NextResponse.json({
    comments: comments.map((c) => ({
      id: c.id,
      text: c.text,
      createdAt: c.createdAt,
      author: authorSummary(c.user),
    })),
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { postId } = await ctx.params

  const body = await req.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.slice(0, 500).trim() : ''
  if (!text) return NextResponse.json({ error: 'Comment cannot be empty' }, { status: 400 })

  const post = await db.communityPost.findUnique({ where: { id: postId }, select: { id: true } })
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const comment = await db.postComment.create({
    data: { postId, userId: me.id, text },
    include: { user: AUTHOR_INCLUDE },
  })

  return NextResponse.json({
    ok: true,
    comment: {
      id: comment.id,
      text: comment.text,
      createdAt: comment.createdAt,
      author: authorSummary(comment.user),
    },
  })
}
