// Quicky — GAME MESSAGE REACTIONS (game-chat PRD §28/§30/§31/§32/§125)
// POST /api/quicky/game-chat/react { messageId, reaction }  (reaction null → remove)
//
// One ACTIVE reaction per user per message (§31 — unique (message_id,
// user_id), a new emoji REPLACES the old one). Only conversation members may
// react (§125). Both members' streams get the update instantly (§32).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { amIMember } from '@/lib/quicky/game-chat'
import { emitGameChatPair } from '@/lib/quicky/game-chat-events'

// ── Reaction validation (revision): the emoji react drawer now offers the
// FULL emoji catalog (WhatsApp-style), so any emoji sequence is accepted —
// up to 16 chars, and it must actually BE an emoji run (Extended_Pictographic
// / ZWJ / variation selectors / modifiers), never plain ASCII text that
// would smuggle a fake message through the reaction field.
const EMOJI_RUN = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200D|\uFE0F)+$/u

function isEmojiRun(reaction: string): boolean {
  if (!reaction || reaction.length > 16) return false
  try {
    return EMOJI_RUN.test(reaction)
  } catch {
    // Ancient engine without unicode property escapes — accept any short
    // non-ASCII run instead of failing the reaction outright.
    return reaction.length <= 16 && !/[a-zA-Z0-9]/.test(reaction)
  }
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const messageId = body?.messageId ? String(body.messageId) : null
  const reaction = body?.reaction == null ? null : String(body.reaction)
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 })
  if (reaction && !isEmojiRun(reaction)) {
    return NextResponse.json({ error: 'invalid_reaction' }, { status: 400 })
  }

  const message = await db.gameMessage.findUnique({
    where: { id: messageId },
    select: { id: true, conversationId: true, conversation: { select: { userAId: true, userBId: true } } },
  })
  if (!message) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const member = await amIMember(message.conversationId, me.id)
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (reaction === null) {
    await db.gameMessageReaction.deleteMany({ where: { messageId, userId: me.id } })
  } else {
    // Upsert on (messageId, userId) — one active reaction per user (§31)
    await db.gameMessageReaction.upsert({
      where: { messageId_userId: { messageId, userId: me.id } },
      update: { reaction },
      create: { messageId, userId: me.id, reaction },
    })
  }

  emitGameChatPair(message.conversation.userAId, message.conversation.userBId, {
    type: 'reaction',
    conversationId: message.conversationId,
    messageId,
  })

  return NextResponse.json({ ok: true })
}
