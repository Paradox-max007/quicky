// Quicky — single community post
// PATCH  /api/quicky/community/posts/[postId]  → edit your own post's caption
// DELETE /api/quicky/community/posts/[postId]  → delete your own post
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { postId } = await ctx.params

  const post = await db.communityPost.findUnique({ where: { id: postId }, select: { userId: true, coOwnerId: true } })
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Either owner of a (mutual) post may edit the caption
  if (post.userId !== me.id && post.coOwnerId !== me.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const caption = typeof body?.caption === 'string' ? body.caption.slice(0, 500).trim() : ''
  const updated = await db.communityPost.update({
    where: { id: postId },
    data: { caption: caption || null },
  })
  return NextResponse.json({ ok: true, caption: updated.caption })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { postId } = await ctx.params

  const post = await db.communityPost.findUnique({ where: { id: postId }, select: { userId: true } })
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (post.userId !== me.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await db.communityPost.delete({ where: { id: postId } })
  return NextResponse.json({ ok: true })
}
