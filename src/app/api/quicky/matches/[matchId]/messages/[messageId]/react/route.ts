// Quicky — emoji reactions on a message (one per user, latest wins)
// POST /api/quicky/matches/[matchId]/messages/[messageId]/react { emoji }
//   empty/missing emoji removes the sender's reaction
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

const MAX_EMOJI_LEN = 16

export async function POST(req: NextRequest, ctx: { params: Promise<{ matchId: string; messageId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { matchId, messageId } = await ctx.params

  const match = await db.match.findUnique({ where: { id: matchId }, select: { id: true, userAId: true, userBId: true } })
  if (!match || (match.userAId !== me.id && match.userBId !== me.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const msg = await db.message.findUnique({ where: { id: messageId }, select: { id: true, matchId: true } })
  if (!msg || msg.matchId !== matchId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const emoji = typeof body?.emoji === 'string' ? body.emoji.slice(0, MAX_EMOJI_LEN).trim() : ''

  if (!emoji) {
    await db.messageReaction.deleteMany({ where: { messageId, userId: me.id } })
    return NextResponse.json({ ok: true, messageId, userId: me.id, emoji: null })
  }

  const reaction = await db.messageReaction.upsert({
    where: { messageId_userId: { messageId, userId: me.id } },
    update: { emoji },
    create: { messageId, userId: me.id, emoji },
  })

  return NextResponse.json({ ok: true, messageId, userId: me.id, emoji: reaction.emoji })
}
