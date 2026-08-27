// Quicky — single community post
// DELETE /api/quicky/community/posts/[postId]  → delete your own post
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

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
