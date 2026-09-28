// Quicky — premium direct message
// POST /api/quicky/dm { toUserId, text }
// Premium members can start a chat with someone they haven't mutually
// matched with yet. Creates (or reuses) a match and posts the message.
//
// NOTE: the existing match-creation flow runs the messaging-privacy gate
// via canMessage() (PRD §18-§21). The recipient's `allowAnyoneMessage`
// setting is enforced even when the sender is Premium (PRD §19).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { pushNotify } from '@/lib/quicky/push'
import { canMessage } from '@/lib/quicky/messaging-privacy'

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

  // ── MESSAGING PRIVACY (Premium Party Games PRD §18-§21)
  // The DM route is the cold-start surface; existing-conversation grand-
  // fathering doesn't apply because the match may not even exist yet. The
  // recipient's `allowAnyoneMessage` setting is enforced — when OFF, only
  // Friends / Connections (mutual Match) may DM. Premium status does NOT
  // bypass this (PRD §19). The block check is folded into canMessage().
  const msgPerm = await canMessage({
    senderId: me.id,
    recipientId: toUserId,
    conversationKey: 'dm',
  })
  if (!msgPerm.allowed) {
    if (msgPerm.reason === 'blocked') {
      return NextResponse.json({ error: 'Not available' }, { status: 403 })
    }
    if (msgPerm.reason === 'recipient_privacy') {
      return NextResponse.json(
        { error: 'recipient_privacy', message: 'They only accept messages from friends and connections.' },
        { status: 403 }
      )
    }
    return NextResponse.json({ error: msgPerm.reason ?? 'not_allowed' }, { status: 403 })
  }

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

  // FCM — message notification to the recipient (gated by their settings).
  void pushNotify(toUserId, 'message', {
    title: `${me.name ?? 'Quicky'} · new message`,
    body: text.slice(0, 90),
    data: { view: 'chat', matchId: match.id },
  })

  return NextResponse.json({ ok: true, matchId: match.id, createdMatch, message: msg })
}
