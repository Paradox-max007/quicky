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
  awardQuickyImage,
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
import { rateLimit } from '@/lib/quicky/rate-limit'
import { getEquippedCosmetics, type CosmeticView } from '@/lib/quicky/rewards/cosmetics'

export const dynamic = 'force-dynamic'

const MAX_TEXT = 2000
// Message types (bug-fix PRD §81). Media URLs MUST come from our own upload
// endpoint (§117 — never an arbitrary client-supplied external URL).
const MEDIA_TYPES = new Set(['image', 'voice', 'quicky_image'])
const ALL_TYPES = new Set(['text', 'sticker', ...MEDIA_TYPES])

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
  // BLOCKED flag (refactor PRD §55): either side blocked → the pair can
  // never DM. The chat screen blurs the peer avatar and shows the
  // failed-to-send caution state from this flag.
  const blockRow = await db.block.findFirst({
    where: {
      OR: [
        { blockerId: me.id, blockedId: peerId! },
        { blockerId: peerId!, blockedId: me.id },
      ],
    },
  })
  // Admin-console PRD §9 — equipped cosmetics for both participants so the
  // chat screen can render bubbles + name decorators + frames.
  const cosmeticsByUser = await getEquippedCosmetics([me.id, peerId!]).catch(() => new Map<string, CosmeticView[]>())
  const compact = (list: CosmeticView[] | undefined) =>
    (list ?? []).map((c) => ({ rewardType: c.rewardType, name: c.name, level: c.level, levelAsset: c.levelAsset, decorator: c.decorator, bubble: c.bubble }))
  const myMember = conversation ? await amIMember(conversation.id, me.id) : null
  const peerMember = conversation ? await amIMember(conversation.id, peerId!) : null

  const rows = conversation ? await loadPage(conversation.id, before) : []
  // Refactor PRD §56 — per-user Clear Chat marker on game conversations too.
  const myCleared = conversation
    ? await db.conversationState.findFirst({ where: { userId: me.id, gameConversationId: conversation.id } })
    : null
  const visibleRows = myCleared ? rows.filter((r) => r.createdAt > myCleared.clearedAt) : rows
  const messages = await serializeMessages(visibleRows)

  return NextResponse.json({
    conversationId: conversation?.id ?? null,
    peer: { ...peer, blocked: !!blockRow, cosmetics: compact(cosmeticsByUser.get(peerId!)) },
    myCosmetics: compact(cosmeticsByUser.get(me.id)),
    hasMore: conversation ? visibleRows.length === MESSAGE_PAGE_SIZE : false,
    oldestCursor: visibleRows.length > 0 ? visibleRows[0].createdAt.toISOString() : null,
    messages,
    myLastReadAt: myMember?.lastReadAt.toISOString() ?? null,
    peerLastReadAt: peerMember?.lastReadAt.toISOString() ?? null,
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // §120: basic server-side flood protection (messages + media uploads).
  if (!rateLimit('gchat_msg', me.id, 30)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const messageType = typeof body?.messageType === 'string' && ALL_TYPES.has(body.messageType)
    ? body.messageType
    : 'text'
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

  // Refactor PRD §55 — block is server-side: a blocked pair can never DM,
  // no matter which surface (or stale client) fires the request.
  const dmPeer = userAId === me.id ? userBId : userAId
  const blockRow = await db.block.findFirst({
    where: {
      OR: [
        { blockerId: me.id, blockedId: dmPeer },
        { blockerId: dmPeer, blockedId: me.id },
      ],
    },
  })
  if (blockRow) return NextResponse.json({ error: 'blocked' }, { status: 403 })

  // ── Validate payload (§75 — never trust the client) ─────────────────────
  let text: string | null = null
  let stickerId: string | null = null
  let mediaUrl: string | null = null
  let mediaDuration: number | null = null

  if (messageType === 'text') {
    text = String(body?.text ?? '').trim().slice(0, MAX_TEXT)
    if (!text) return NextResponse.json({ error: 'text_required' }, { status: 400 })
  } else if (messageType === 'sticker') {
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
  } else {
    // ── image | voice | quicky_image (bug-fix PRD §56-§67/§116-§118) ──
    if (!rateLimit('gchat_media', me.id, 12)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    }
    mediaUrl = body?.mediaUrl ? String(body.mediaUrl) : null
    // §117/§118: ONLY our own upload endpoint's paths are accepted — an
    // arbitrary external URL can never be injected into the message DB.
    if (!mediaUrl || !mediaUrl.startsWith('/uploads/')) {
      return NextResponse.json({ error: 'media_required' }, { status: 400 })
    }
    if (messageType === 'voice') {
      const d = Number(body?.mediaDuration)
      mediaDuration = Number.isFinite(d) && d > 0 && d <= 5 * 60_000 ? Math.round(d) : null
      if (!mediaDuration) return NextResponse.json({ error: 'media_duration_required' }, { status: 400 })
    }
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

  const insertMessage = () =>
    db.gameMessage.create({
      data: {
        conversationId: conversationId!,
        senderId: me.id,
        messageType,
        text,
        stickerId,
        mediaUrl,
        mediaDuration,
        replyToMessageId,
        clientMessageId,
      },
      include: { reactions: true, sticker: { select: { id: true, name: true, assetUrl: true } } },
    })

  // ── Idempotent insert (§92/§93) + lastMessageAt stamp ────────────────────
  let created: Awaited<ReturnType<typeof insertMessage>> | null = null
  // §73/§148: the award path must know whether THIS request actually
  // inserted the row — a P2002 recovery (optimistic retry) returns the
  // stored row but must NEVER re-run the Quicky economy.
  let freshInsert = false
  try {
    created = await insertMessage()
    freshInsert = true
  } catch (e: any) {
    if (e?.code === 'P2002' && clientMessageId) {
      // Same optimistic send retried — return the stored row (§92).
      created = await db.gameMessage.findFirst({
        where: { conversationId: conversationId!, senderId: me.id, clientMessageId },
        include: { reactions: true, sticker: { select: { id: true, name: true, assetUrl: true } } },
      })
    } else {
      throw e
    }
  }

  if (!created) return NextResponse.json({ error: 'send_failed' }, { status: 500 })

  // ── Quicky Image economy (bug-fix PRD §70-§79) — server-calculated award,
  // applied exactly once per STORED message (§72/§73): only a FRESH insert
  // awards; the P2002 retry path above never reaches this.
  if (created.messageType === 'quicky_image' && freshInsert) {
    await awardQuickyImage(me.id, peerUserId ?? (userAId === me.id ? userBId : userAId), created.id)
  }

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

// Refactor PRD §56 — Clear Chat for game personal conversations: per-user
// marker only; the peer's history is untouched.
export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const conversationId = req.nextUrl.searchParams.get('conversationId') ?? ''
  if (!conversationId) return NextResponse.json({ error: 'conversationId required' }, { status: 400 })

  const row = await db.gameConversation.findUnique({ where: { id: conversationId } })
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.userAId !== me.id && row.userBId !== me.id)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const existing = await db.conversationState.findFirst({
    where: { userId: me.id, gameConversationId: conversationId },
  })
  if (existing) {
    await db.conversationState.update({ where: { id: existing.id }, data: { clearedAt: new Date() } })
  } else {
    await db.conversationState.create({ data: { userId: me.id, gameConversationId: conversationId, clearedAt: new Date() } })
  }
  return NextResponse.json({ ok: true })
}
