// Quicky — premium direct message
// POST /api/quicky/dm { toUserId, text }
// Premium members can start a chat with someone they haven't mutually
// matched with yet. Creates (or reuses) a match and posts the message.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!me.isPremium) {
    return NextResponse.json({ error: 'premium_required', paywall: 'dm' }, { status: 402 })
  }

  const body = await req.json()
  const toUserId = String(body.toUserId ?? '')
  const text = String(body.text ?? '').slice(0, 1000).trim()
  if (!toUserId || toUserId === me.id) {
    return NextResponse.json({ error: 'Invalid recipient' }, { status: 400 })
  }
  if (!text) return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 })

  const target = await db.user.findUnique({ where: { id: toUserId } })
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Blocked either way? Refuse.
  const block = await db.block.findFirst({
    where: {
      OR: [
        { blockerId: me.id, blockedId: toUserId },
        { blockerId: toUserId, blockedId: me.id },
      ],
    },
  })
  if (block) return NextResponse.json({ error: 'Not available' }, { status: 403 })

  // Reuse an existing active match between the two users, otherwise create one
  let match = await db.match.findFirst({
    where: {
      status: 'active',
      OR: [
        { userAId: me.id, userBId: toUserId },
        { userAId: toUserId, userBId: me.id },
      ],
    },
  })
  const createdMatch = !match
  if (!match) {
    const [userAId, userBId] = [me.id, toUserId].sort()
    match = await db.match.create({ data: { userAId, userBId } })
  }

  const msg = await db.message.create({
    data: {
      matchId: match.id,
      senderId: me.id,
      type: 'text',
      text,
    },
  })
  await db.match.update({
    where: { id: match.id },
    data: { lastMessageAt: new Date() },
  })

  return NextResponse.json({ ok: true, matchId: match.id, createdMatch, message: msg })
}
