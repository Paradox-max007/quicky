// Quicky — comments on a community post
// GET  /api/quicky/community/posts/[postId]/comments
// POST /api/quicky/community/posts/[postId]/comments { text }
//
// GET also returns a VIEWER CONTEXT so the client can render the right UI:
//   viewer: { id, isOwner, isBanned, ownerName }
//     · isOwner  — the viewer authored (or co-owns) the post → comment
//       chips get Delete / Report / Ban actions
//     · isBanned — one of the post's owners banned the viewer from
//       commenting → the composer is hidden server-verified
// POST enforces that ban server-side (403) regardless of UI state.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { authorSummary, AUTHOR_INCLUDE } from '@/lib/quicky/community-server'

export const dynamic = 'force-dynamic'

/** Everyone who owns this post (author + co-owner). */
function ownerIdsOf(post: { userId: string; coOwnerId: string | null }): string[] {
  return post.coOwnerId ? [post.userId, post.coOwnerId] : [post.userId]
}

/** True when the viewer is banned from commenting by any owner of this post. */
async function viewerIsBanned(viewerId: string, post: { userId: string; coOwnerId: string | null }): Promise<boolean> {
  const ban = await db.postCommentBan.findFirst({
    where: { bannedId: viewerId, ownerId: { in: ownerIdsOf(post) } },
    select: { id: true },
  })
  return !!ban
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { postId } = await ctx.params

  const post = await db.communityPost.findUnique({
    where: { id: postId },
    select: { userId: true, coOwnerId: true },
  })
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [comments, isBanned, owner] = await Promise.all([
    db.postComment.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: { user: AUTHOR_INCLUDE },
    }),
    viewerIsBanned(me.id, post),
    db.user.findUnique({ where: { id: post.userId }, select: { name: true } }),
  ])

  return NextResponse.json({
    comments: comments.map((c) => ({
      id: c.id,
      text: c.text,
      createdAt: c.createdAt,
      author: authorSummary(c.user),
    })),
    viewer: {
      id: me.id,
      isOwner: ownerIdsOf(post).includes(me.id),
      isBanned,
      ownerName: owner?.name ?? null,
    },
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { postId } = await ctx.params

  const body = await req.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.slice(0, 500).trim() : ''
  if (!text) return NextResponse.json({ error: 'Comment cannot be empty' }, { status: 400 })

  const post = await db.communityPost.findUnique({
    where: { id: postId },
    select: { id: true, commentsEnabled: true, userId: true, coOwnerId: true },
  })
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Per-post opt-out — server enforces regardless of UI state
  if (post.commentsEnabled === false) {
    return NextResponse.json({ error: 'Comments are off on this post' }, { status: 403 })
  }
  // Comment ban — one of this post's owners banned the viewer (applies to
  // ALL of that owner's posts, past and future)
  if (await viewerIsBanned(me.id, post)) {
    return NextResponse.json({ error: 'You can no longer comment on this user’s posts' }, { status: 403 })
  }

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
