// Quicky — GAME CHAT MESSAGES (game-chat PRD §22/§23/§24/§92/§94/§95/§125)
// GET  /api/quicky/game-chat/messages?peerUserId=...|conversationId=...&before=ISO
// POST /api/quicky/game-chat/messages { peerUserId?, conversationId?, ... }
//
// GET · Resolves the conversation WITHOUT creating one (§10) — opening a
//       fresh "Say hello 👋" chat writes nothing.
//     · Cursor pagination: latest page first, `before` fetches older pages (§24).
//     · Membership is verified for conversationId access (§125); peerUserId
//       access IS the membership (it's my own pair).
//     · Returns both members' read stamps so the sender can render ✓ / ✓✓ (§17).
//
// POST · Conversation is created ON FIRST REAL MESSAGE only (§10) via a
//        race-safe upsert on the canonical pair (§11 — never duplicates).
//      · clientMessageId makes optimistic retries idempotent (§92/§93).
//      · Sticker messages are server-validated: sticker exists + active +
//        user OWNS the bundle (§74/§75).
//      · Both members' streams are poked instantly (§19/§22).
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import {
  amIMember,
  canonicalPair,
  ensureMembers,
  getOrCreateConversation,
  loadPage,
  otherMemberId,
  peerInfo,
  serializeMessages,
  MESSAGE_PAGE_SIZE,
} from '@/lib/quicky/game-chat'
import { emitGameChatPair } from '@/lib/quicky/game-chat-events'

export const dynamic = 'force-dynamic'

const MAX_TEXT = 2000

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = req.nextUrl.searchParams
  const peerUserId = url.get('peerUserId')
  const conversationId = url.get('conversationId')
  const before = url.get('before')

  let conversation: { id: string; userAId: string; userBId: string } | null = null
  let peerId: string | null = null

  if (conversationId) {
    const row = await db.gameConversation.findUnique({ where: { id: conversationId } })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (row.userAId !== me.id && row.userBId !== me.id) {
      // §125: users can only read conversations they belong to
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    conversation = row
    peerId = otherMemberId(row, me.id)
  } else if (peerUserId) {
    if (me.id === peerUserId) return NextResponse.json({ error: 'Cannot chat with yourself' }, { status: 400 })
    const { userAId, userBId } = canonicalPair(me.id, peerUserId)
    peerId = peerUserId
    conversation = await db.gameConversation.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
    })
  } else {
    return NextResponse.json({ error: 'peerUserId or conversationId required' }, { status: 400 })
  }

  const peer = await peerInfo(peerId!)
  const myMember = conversation ? await amIMember(conversation.id, me.id) : null
  const peerMember = conversation ? await amIMember(conversation.id, peerId!) : null

  const rows = conversation ? await loadPage(conversation.id, before) : []
  const messages = await serializeMessages(rows)

  return NextResponse.json({
    conversationId: conversation?.id ?? null,
    peer,
    hasMore: conversation ? rows.length === MESSAGE_PAGE_SIZE : false,
    oldestCursor: rows.length > 0 ? rows[0].createdAt.toISOString() : null,
    messages,
    myLastReadAt: myMember?.lastReadAt.toISOString() ?? null,
    peerLastReadAt: peerMember?.lastReadAt.toISOString() ?? null,
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const messageType = body?.messageType === 'sticker' ? 'sticker' : 'text'
  let peerUserId: string | null = body?.peerUserId ? String(body.peerUserId) : null
  let conversationId: string | null = body?.conversationId ? String(body.conversationId) : null

  // ── Resolve/create the conversation ──────────────────────────────────────
  if (conversationId) {
    const existing = await db.gameConversation.findUnique({ where: { id: conversationId } })
    if (!existing) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    if (existing.userAId !== me.id && existing.userBId !== me.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    peerUserId = existing.userAId === me.id ? existing.userBId : existing.userAId
  } else if (peerUserId) {
    if (peerUserId === me.id) return NextResponse.json({ error: 'Cannot chat with yourself' }, { status: 400 })
    const peer = await db.user.findUnique({ where: { id: peerUserId }, select: { id: true } })
    if (!peer) return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    const conversation = await getOrCreateConversation(me.id, peerUserId)
    if (!conversation) return NextResponse.json({ error: 'Cannot create conversation' }, { status: 400 })
    conversationId = conversation.id
  } else {
    return NextResponse.json({ error: 'peerUserId or conversationId required' }, { status: 400 })
  }

  const convRow = await db.gameConversation.findUniqueOrThrow({ where: { id: conversationId! } })
  const { userAId, userBId } = canonicalPair(convRow.userAId, convRow.userBId)

  // ── Validate payload (§75 — never trust the client) ─────────────────────
  let text: string | null = null
  let stickerId: string | null = null

  if (messageType === 'text') {
    text = String(body?.text ?? '').trim().slice(0, MAX_TEXT)
    if (!text) return NextResponse.json({ error: 'text_required' }, { status: 400 })
  } else {
    stickerId = body?.stickerId ? String(body.stickerId) : null
    if (!stickerId) return NextResponse.json({ error: 'stickerId_required' }, { status: 400 })
    const sticker = await db.gameSticker.findUnique({
      where: { id: stickerId },
      include: { bundle: { select: { id: true, isActive: true } } },
    })
    // §75: sticker exists AND sticker active AND user owns sticker/bundle
    if (!sticker || !sticker.isActive || !sticker.bundle.isActive) {
      return NextResponse.json({ error: 'sticker_unavailable' }, { status: 400 })
    }
    const owned = await db.userGameStickerBundle.findUnique({
      where: { userId_bundleId: { userId: me.id, bundleId: sticker.bundle.id } },
    })
    if (!owned) return NextResponse.json({ error: 'sticker_not_owned' }, { status: 403 })
  }

  // Reply reference must belong to the same conversation (§27)
  const replyToMessageId = body?.replyToMessageId ? String(body.replyToMessageId) : null
  if (replyToMessageId) {
    const ref = await db.gameMessage.findUnique({ where: { id: replyToMessageId } })
    if (!ref || ref.conversationId !== conversationId) {
      return NextResponse.json({ error: 'invalid_reply_target' }, { status: 400 })
    }
  }

  const clientMessageId = body?.clientMessageId ? String(body.clientMessageId).slice(0, 64) : null

  // ── Idempotent insert (§92/§93) + lastMessageAt stamp ────────────────────
  const created = await db.gameMessage
    .create({
      data: {
        conversationId: conversationId!,
        senderId: me.id,
        messageType,
        text,
        stickerId,
        replyToMessageId,
        clientMessageId,
      },
      include: { reactions: true, sticker: { select: { id: true, name: true, assetUrl: true } } },
    })
    .catch(async (e: any) => {
      if (e?.code === 'P2002' && clientMessageId) {
        // Same optimistic send retried — return the stored row (§92)
        const existing = await db.gameMessage.findFirst({
          where: { conversationId: conversationId!, senderId: me.id, clientMessageId },
          include: { reactions: true, sticker: { select: { id: true, name: true, assetUrl: true } } },
        })
        return existing
      }
      throw e
    })

  if (!created) return NextResponse.json({ error: 'send_failed' }, { status: 500 })

  await Promise.all([
    db.gameConversation
      .update({ where: { id: conversationId! }, data: { lastMessageAt: created.createdAt } })
      .catch(() => {}),
    ensureMembers(conversationId!, [userAId, userBId]),
  ])

  const [serialized] = await serializeMessages([created])

  // ── Realtime push to BOTH members (§19/§22/§90) ─────────────────────────
  emitGameChatPair(userAId, userBId, {
    type: 'message',
    conversationId: conversationId!,
    message: serialized,
  })
  emitGameChatPair(userAId, userBId, { type: 'conversation', conversationId: conversationId! })

  return NextResponse.json({ ok: true, conversationId, message: serialized })
}
