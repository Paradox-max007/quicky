// Quicky — GAME CHAT LIST (game-chat PRD §7/§8/§9/§87/§88/§89/§90)
// GET /api/quicky/game-chat/conversations
//
// ONLY conversations where an actual message exists (§9 — never auto-created
// by room co-presence, never an empty placeholder). Each row: peer identity,
// last-message preview, timestamp, unread count; sorted last_message_at
// DESC (§88).
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { peerInfo, unreadCount } from '@/lib/quicky/game-chat'

export const dynamic = 'force-dynamic'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const conversations = await db.gameConversation.findMany({
    where: {
      OR: [{ userAId: me.id }, { userBId: me.id }],
      lastMessageAt: { not: null }, // §9: only real conversations
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
    include: { members: true },
  })

  const rows = await Promise.all(
    conversations.map(async (c) => {
      const peerId = c.userAId === me.id ? c.userBId : c.userAId
      const [peer, lastMessage, myMember] = await Promise.all([
        peerInfo(peerId),
        db.gameMessage.findFirst({
          where: { conversationId: c.id, deletedAt: null },
          orderBy: [{ createdAt: 'desc' }],
          select: {
            id: true,
            senderId: true,
            messageType: true,
            text: true,
            createdAt: true,
            sticker: { select: { name: true } },
          },
        }),
        c.members.find((m) => m.userId === me.id),
      ])
      const unread = myMember
        ? await unreadCount(c.id, me.id, myMember.lastReadAt, peerId)
        : 0
      return {
        conversationId: c.id,
        peer,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              senderId: lastMessage.senderId,
              fromMe: lastMessage.senderId === me.id,
              messageType: lastMessage.messageType,
              // §87 preview — sticker messages preview as their name
              preview:
                lastMessage.messageType === 'sticker'
                  ? `${lastMessage.sticker?.name ?? 'Sticker'} `
                  : lastMessage.text ?? '',
              createdAt: lastMessage.createdAt.toISOString(),
            }
          : null,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        unread,
      }
    })
  )

  return NextResponse.json({ conversations: rows })
}
