// Quicky — MARK GAME CHAT READ (game-chat PRD §15/§16/§17)
// POST /api/quicky/game-chat/read { conversationId }
//
// Called when the chat screen becomes visible AND when a new message arrives
// while the user is actively viewing the conversation (§16). Only the
// caller's own read stamp is written (§125). The PEER's stream is poked so
// their ✓ flips to ✓✓ live (§17).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { otherMemberId } from '@/lib/quicky/game-chat'
import { emitGameChatUser } from '@/lib/quicky/game-chat-events'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const conversationId = body?.conversationId ? String(body.conversationId) : null
  if (!conversationId) return NextResponse.json({ error: 'conversationId required' }, { status: 400 })

  const conversation = await db.gameConversation.findUnique({ where: { id: conversationId } })
  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (conversation.userAId !== me.id && conversation.userBId !== me.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const lastReadAt = new Date()
  await db.gameConversationMember.upsert({
    where: { conversationId_userId: { conversationId, userId: me.id } },
    update: { lastReadAt },
    create: { conversationId, userId: me.id, lastReadAt },
  })

  // Read receipts are instant (§17): poke the peer's stream.
  const peerId = otherMemberId(conversation, me.id)
  emitGameChatUser(peerId, {
    type: 'read',
    conversationId,
    userId: me.id,
    lastReadAt: lastReadAt.toISOString(),
  })

  return NextResponse.json({ ok: true, lastReadAt: lastReadAt.toISOString() })
}
