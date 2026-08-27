// Quicky — comments on a roll (gated: owner, premium, or mutual match)
// GET  /api/quicky/rolls/[rollId]/comments
// POST /api/quicky/rolls/[rollId]/comments { text }
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import {
  authorSummary,
  AUTHOR_INCLUDE,
  hasMutualMatch,
} from '@/lib/quicky/community-server'

export const dynamic = 'force-dynamic'

async function gate(me: { id: string; isPremium: boolean }, rollId: string) {
  const roll = await db.roll.findUnique({ where: { id: rollId }, select: { userId: true, expiresAt: true } })
  if (!roll || roll.expiresAt < new Date()) return { error: 'Not found' as const, status: 404 }
  if (roll.userId !== me.id && !me.isPremium && !(await hasMutualMatch(me.id, roll.userId))) {
    return { error: 'premium_or_match_required' as const, status: 402 }
  }
  return null
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ rollId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { rollId } = await ctx.params

  const blocked = await gate(me, rollId)
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status })

  const comments = await db.rollComment.findMany({
    where: { rollId },
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

export async function POST(req: NextRequest, ctx: { params: Promise<{ rollId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { rollId } = await ctx.params

  const body = await req.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.slice(0, 500).trim() : ''
  if (!text) return NextResponse.json({ error: 'Comment cannot be empty' }, { status: 400 })

  const blocked = await gate(me, rollId)
  if (blocked) return NextResponse.json({ error: blocked.error }, { status: blocked.status })

  const comment = await db.rollComment.create({
    data: { rollId, userId: me.id, text },
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
