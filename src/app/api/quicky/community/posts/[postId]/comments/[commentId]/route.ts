// Quicky — delete a comment on a community post
// DELETE /api/quicky/community/posts/[postId]/comments/[commentId]
//
// Allowed for:
//   · the comment's author (deleting their own comment), or
//   · the post's owner / co-owner (moderating comments on their post)
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ postId: string; commentId: string }> }) {
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

  const isCommentAuthor = comment.userId === me.id
  const isPostOwner = post.userId === me.id || post.coOwnerId === me.id
  if (!isCommentAuthor && !isPostOwner) {
    return NextResponse.json({ error: 'Not allowed to delete this comment' }, { status: 403 })
  }

  await db.postComment.delete({ where: { id: commentId } })
  return NextResponse.json({ ok: true })
}
