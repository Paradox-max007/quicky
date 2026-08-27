// Quicky — like a roll (gated: owner, premium, or mutual match)
// POST /api/quicky/rolls/[rollId]/like  → toggles the viewer's like
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { hasMutualMatch } from '@/lib/quicky/community-server'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ rollId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { rollId } = await ctx.params

  const roll = await db.roll.findUnique({ where: { id: rollId }, select: { userId: true, expiresAt: true } })
  if (!roll || roll.expiresAt < new Date()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (roll.userId !== me.id && !me.isPremium && !(await hasMutualMatch(me.id, roll.userId))) {
    return NextResponse.json({ error: 'premium_or_match_required', paywall: 'rolls' }, { status: 402 })
  }

  const existing = await db.rollLike.findUnique({
    where: { rollId_userId: { rollId, userId: me.id } },
  })

  if (existing) {
    await db.rollLike.delete({ where: { id: existing.id } })
  } else {
    await db.rollLike.create({ data: { rollId, userId: me.id } })
  }

  const likeCount = await db.rollLike.count({ where: { rollId } })
  return NextResponse.json({ ok: true, likedByMe: !existing, likeCount })
}
