// Quicky — list messages + send text/image message in a match
// GET  /api/quicky/matches/[matchId]/messages  -> list messages (with reactions + reply previews)
// POST /api/quicky/matches/[matchId]/messages  { type, text?, mediaUrl?, replyToId? } -> send message
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { deleteUploadedMedia } from '@/lib/quicky/media-cleanup'

// Hard TTL safety net: expired, unconsumed Quickies are consumed + their
// media permanently deleted even if the client never reported the view.
async function sweepExpiredQuickies(matchId: string) {
  const expired = await db.message.findMany({
    where: { matchId, type: 'quicky', quickyConsumedAt: null, quickyExpiresAt: { lt: new Date() } },
  })
  for (const m of expired) {
    deleteUploadedMedia(m.mediaUrl)
    await db.message
      .update({ where: { id: m.id }, data: { quickyConsumedAt: new Date(), mediaUrl: null } })
      .catch(() => {})
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ matchId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { matchId } = await ctx.params

  const match = await db.match.findUnique({
    where: { id: matchId },
    include: {
      userA: { include: { photos: { orderBy: { position: 'asc' } }, settings: true } },
      userB: { include: { photos: { orderBy: { position: 'asc' } }, settings: true } },
    },
  })
  if (!match || (match.userAId !== me.id && match.userBId !== me.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (match.status !== 'active') return NextResponse.json({ error: 'Unmatched' }, { status: 410 })

  const partner = match.userAId === me.id ? match.userB : match.userA

  // BLOCKED (refactor PRD §55 parity with game-chat): either side blocked →
  // the pair can never DM. The client renders the failed-to-send state with
  // the caution icon and blurs the partner avatar from this flag.
  const blockRow = await db.block.findFirst({
    where: {
      OR: [
        { blockerId: me.id, blockedId: partner.id },
        { blockerId: partner.id, blockedId: me.id },
      ],
    },
  })
  const blocked = !!blockRow

  void sweepExpiredQuickies(matchId) // fire-and-forget: cleanup doesn't block the response

  // Refactor PRD §56 — per-user Clear Chat: MY view starts after my marker;
  // the partner's history is never destroyed.
  const convState = await db.conversationState.findFirst({ where: { userId: me.id, matchId } })
  const clearedAt = convState?.clearedAt ?? null

  const messages = await db.message.findMany({
    where: { matchId, ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}) },
    orderBy: { createdAt: 'asc' },
    take: 200,
    include: {
      reactions: { select: { emoji: true, userId: true } },
      replyTo: { select: { id: true, type: true, text: true, senderId: true, quickyDuration: true } },
    },
  })


  // Recipient's device fetched the chat → partner's messages are delivered.
  const undeliveredIds = messages
    .filter((m) => m.senderId !== me.id && !m.deliveredAt)
    .map((m) => m.id)
  if (undeliveredIds.length > 0) {
    await db.message
      .updateMany({ where: { id: { in: undeliveredIds } }, data: { deliveredAt: new Date() } })
      .catch(() => {})
  }

  // Opening the chat marks the partner's unread messages as read.
  const unreadIds = messages
    .filter((m) => m.senderId !== me.id && !m.readAt)
    .map((m) => m.id)
  if (unreadIds.length > 0) {
    await db.message.updateMany({ where: { id: { in: unreadIds } }, data: { readAt: new Date() } })
  }

  // The partner can hide read receipts (premium privacy setting) — if so,
  // don't leak readAt timestamps for their own messages back to us... we're
  // returning OUR view: hide readAt on messages the partner has READ (i.e.
  // our messages) when the partner hides receipts.
  const partnerHidesReceipts = !!partner.settings?.privacyHideReadReceipts

  return NextResponse.json({
    match: {
      id: match.id,
      partner: {
        id: partner.id,
        name: partner.name,
        age: partner.age,
        isPremium: partner.isPremium,
        isVerified: partner.isVerified,
        quickyScore: partner.quickyScore,
        photo: partner.photos[0]?.url ?? null,
        bio: partner.bio,
        interests: partner.interests ? JSON.parse(partner.interests) : [],
        city: partner.city,
        lastActiveAt: partner.lastActiveAt,
        hideOnline: !!partner.settings?.privacyHideOnline,
        hideTyping: !!partner.settings?.privacyHideTyping,
        hideReadReceipts: partnerHidesReceipts,
        blocked,
      },
    },
    me: { id: me.id, isPremium: me.isPremium },
    readMessageIds: unreadIds,
    messages: messages.map((m) => {
      const consumed = m.type === 'quicky' && !!m.quickyConsumedAt
      return {
        id: m.id,
        senderId: m.senderId,
        type: m.type,
        text: m.text,
        // Consumed Quickies are unrecoverable — the URL is gone for good
        mediaUrl: consumed ? null : m.mediaUrl,
        quickyDuration: m.quickyDuration,
        quickyOpenedAt: m.quickyOpenedAt,
        quickyConsumedAt: m.quickyConsumedAt,
        quickyExpiresAt: m.quickyExpiresAt,
        mediaDuration: m.mediaDuration,
        screenshotFlagged: m.screenshotFlagged,
        deliveredAt: m.deliveredAt,
        // Mask receipts when the reader of these messages (the partner) hides them
        readAt: partnerHidesReceipts && m.senderId === me.id ? null : m.readAt,
        replyTo: m.replyTo
          ? {
              id: m.replyTo.id,
              senderId: m.replyTo.senderId,
              type: m.replyTo.type,
              snippet:
                m.replyTo.type === 'sticker'
                  ? `Sticker · ${m.replyTo.text ?? ''}`
                  : m.replyTo.text ??
                    (m.replyTo.type === 'quicky' ? 'Quicky' : m.replyTo.type === 'video' ? 'Video' : 'Photo'),
              duration: m.replyTo.quickyDuration,
            }
          : null,
        reactions: m.reactions,
        createdAt: m.createdAt,
      }
    }),
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ matchId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { matchId } = await ctx.params

  const match = await db.match.findUnique({ where: { id: matchId } })
  if (!match || (match.userAId !== me.id && match.userBId !== me.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (match.status !== 'active') return NextResponse.json({ error: 'Unmatched' }, { status: 410 })

  // ── BLOCK ENFORCEMENT (refactor PRD §55): a blocked pair can never DM,
  // no matter which surface fires the request. The message is refused
  // BEFORE the row is created — nothing is stored, so after a re-login or
  // refresh the failed message is simply gone. Both directions blocked.
  const dmPeer = match.userAId === me.id ? match.userBId : match.userAId
  const blockRow = await db.block.findFirst({
    where: {
      OR: [
        { blockerId: me.id, blockedId: dmPeer },
        { blockerId: dmPeer, blockedId: me.id },
      ],
    },
  })
  if (blockRow) return NextResponse.json({ error: 'blocked' }, { status: 403 })

  const body = await req.json()
  const type = String(body.type ?? 'text') as 'text' | 'image' | 'video' | 'voice' | 'sticker' | 'system'
  if (!['text', 'image', 'video', 'voice', 'sticker'].includes(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }

  // ── Sticker messages: the server resolves the asset AND verifies the
  // sender owns the sticker's bundle (UserGameStickerBundle) — same rule as
  // game-chat §75 and room chat. text carries the sticker NAME (previews /
  // reply snippets); mediaUrl carries the asset reference (image URL or the
  // emoji glyph itself — the client renders both through the sticker path).
  let sticker: { id: string; name: string; assetUrl: string } | null = null
  if (type === 'sticker') {
    const stickerId = body?.stickerId ? String(body.stickerId) : ''
    if (!stickerId) return NextResponse.json({ error: 'stickerId required' }, { status: 400 })
    const row = await db.gameSticker.findUnique({
      where: { id: stickerId },
      include: { bundle: { select: { id: true, isActive: true } } },
    })
    if (!row || !row.isActive || !row.bundle.isActive) {
      return NextResponse.json({ error: 'sticker_unavailable' }, { status: 400 })
    }
    const owned = await db.userGameStickerBundle.findUnique({
      where: { userId_bundleId: { userId: me.id, bundleId: row.bundle.id } },
    })
    if (!owned) return NextResponse.json({ error: 'sticker_not_owned' }, { status: 403 })
    sticker = { id: row.id, name: row.name, assetUrl: row.assetUrl }
  }

  const text = sticker ? sticker.name : body.text ? String(body.text).slice(0, 1000) : null
  const mediaUrl = sticker ? sticker.assetUrl : body.mediaUrl ? String(body.mediaUrl) : null
  if (!text && !mediaUrl) {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  }
  // Voice message duration in ms (clamped to the 60 s PRD limit)
  const mediaDuration =
    type === 'voice'
      ? Math.max(0, Math.min(60000, Number.isFinite(Number(body.durationMs)) ? Number(body.durationMs) : 0))
      : null

  // Optional reply / quote target
  let replyToId: string | null = null
  let replyTo: { id: string; senderId: string; type: string; snippet: string; duration: number | null } | null = null
  if (body.replyToId) {
    const target = await db.message.findUnique({
      where: { id: String(body.replyToId) },
      select: { id: true, matchId: true, type: true, text: true, senderId: true },
    })
    if (target && target.matchId === matchId) {
      replyToId = target.id
      replyTo = {
        id: target.id,
        senderId: target.senderId,
        type: target.type,
        snippet: target.type === 'sticker' ? `Sticker · ${target.text ?? ''}` : (target.text ?? target.type),
        duration: null,
      }
    }
  }

  const msg = await db.message.create({
    data: { matchId, senderId: me.id, type, text, mediaUrl, mediaDuration, replyToId },
  })
  await db.match.update({
    where: { id: matchId },
    data: { lastMessageAt: new Date() },
  })

  return NextResponse.json({
    ok: true,
    message: {
      id: msg.id,
      senderId: msg.senderId,
      type: msg.type,
      text: msg.text,
      mediaDuration: msg.mediaDuration,
      mediaUrl: msg.mediaUrl,
      deliveredAt: null,
      readAt: null,
      replyTo,
      reactions: [],
      createdAt: msg.createdAt,
    },
  })
}

// Refactor PRD §56 — Clear Chat: confirm-on-client, per-user marker on
// server. The other participant keeps their history (§56 retention rule).
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ matchId: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { matchId } = await ctx.params

  const match = await db.match.findUnique({ where: { id: matchId } })
  if (!match || (match.userAId !== me.id && match.userBId !== me.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const existing = await db.conversationState.findFirst({ where: { userId: me.id, matchId } })
  if (existing) {
    await db.conversationState.update({ where: { id: existing.id }, data: { clearedAt: new Date() } })
  } else {
    await db.conversationState.create({ data: { userId: me.id, matchId, clearedAt: new Date() } })
  }
  return NextResponse.json({ ok: true })
}
