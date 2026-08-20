// Quicky — unmatch
// POST /api/quicky/matches/[matchId]/unmatch
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function POST(req: NextRequest, ctx: { params: Promise<{ matchId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { matchId } = await ctx.params

  const match = await db.match.findUnique({ where: { id: matchId } })
  if (!match || (match.userAId !== me.id && match.userBId !== me.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const updated = await db.match.update({
    where: { id: matchId },
    data: { status: 'unmatched' },
  })
  await db.message.create({
    data: {
      matchId,
      senderId: me.id,
      type: 'system',
      text: 'This match was ended.',
    },
  })

  return NextResponse.json({ ok: true, status: updated.status })
}
