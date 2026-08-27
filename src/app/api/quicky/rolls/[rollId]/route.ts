// Quicky — single roll
// DELETE /api/quicky/rolls/[rollId]  → delete your own roll
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ rollId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { rollId } = await ctx.params

  const roll = await db.roll.findUnique({ where: { id: rollId }, select: { userId: true } })
  if (!roll) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (roll.userId !== me.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await db.roll.delete({ where: { id: rollId } })
  return NextResponse.json({ ok: true })
}
