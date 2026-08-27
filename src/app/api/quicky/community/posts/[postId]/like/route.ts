// Quicky — like / unlike a community post
// POST /api/quicky/community/posts/[postId]/like  → toggles the viewer's like
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { postId } = await ctx.params

  const post = await db.communityPost.findUnique({ where: { id: postId }, select: { id: true } })
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const existing = await db.postLike.findUnique({
    where: { postId_userId: { postId, userId: me.id } },
  })

  if (existing) {
    await db.postLike.delete({ where: { id: existing.id } })
  } else {
    await db.postLike.create({ data: { postId, userId: me.id } })
  }

  const likeCount = await db.postLike.count({ where: { postId } })
  return NextResponse.json({ ok: true, likedByMe: !existing, likeCount })
}
