// Quicky — ban a user from commenting (community post owner moderation)
// POST /api/quicky/community/posts/[postId]/comments/[commentId]/ban
//
// Only the post's owner / co-owner may ban. The ban applies to the comment's
// author and covers ALL of the ban-giving user's posts — past and future —
// but NOT anyone else's posts (per-owner, not global). The client confirms
// with a modal before calling this; the server enforces regardless.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ postId: string; commentId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { postId, commentId } = await ctx.params

  const comment = await db.postComment.findUnique({
    where: { id: commentId },
    select: { id: true, postId: true, userId: true },
  })
  if (!comment || comment.postId !== postId) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  const post = await db.communityPost.findUnique({
    where: { id: postId },
    select: { userId: true, coOwnerId: true },
  })
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  // Only an owner of THIS post can hand out a ban from it
  if (post.userId !== me.id && post.coOwnerId !== me.id) {
    return NextResponse.json({ error: 'Only the post owner can ban commenters' }, { status: 403 })
  }
  // Sanity guards: no banning yourself / the post's owners
  if (comment.userId === me.id) {
    return NextResponse.json({ error: 'Cannot ban yourself' }, { status: 400 })
  }
  if (comment.userId === post.userId || comment.userId === post.coOwnerId) {
    return NextResponse.json({ error: 'Cannot ban an owner of this post' }, { status: 400 })
  }

  await db.postCommentBan.upsert({
    where: { ownerId_bannedId: { ownerId: me.id, bannedId: comment.userId } },
    create: { ownerId: me.id, bannedId: comment.userId },
    update: {}, // idempotent — banning twice is a no-op
  })

  return NextResponse.json({ ok: true })
}
