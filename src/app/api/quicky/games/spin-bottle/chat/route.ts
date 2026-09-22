// Quicky — Spin the Bottle room chat
// GET  /api/quicky/games/spin-bottle/chat?roomId=...   → recent 80
// POST /api/quicky/games/spin-bottle/chat  { roomId, text }
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { touchMemberActivity } from '@/lib/quicky/room-activity'
import { emitGameChatUser } from '@/lib/quicky/game-chat-events'

const RATE_LIMIT_MS = 1500

// A naive per-user rate limit (kept in-memory — fine for V1 single-process).
const lastSentAt = new Map<string, number>()

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roomId = req.nextUrl.searchParams.get('roomId') ?? ''
  if (!roomId) return NextResponse.json({ error: 'roomId required' }, { status: 400 })

  const member = await db.spinRoomPlayer.findFirst({ where: { roomId, userId: me.id, leftAt: null } })
  if (!member) return NextResponse.json({ error: 'Not in room' }, { status: 403 })

  const msgs = await db.spinRoomMessage.findMany({
    where: { roomId, kind: 'user' },
    orderBy: { createdAt: 'desc' },
    take: 80,
    include: {
      user: { select: { name: true, id: true } },
      mentions: { select: { mentionedUserId: true, mentionedByUserId: true } },
    },
  })
  // §56: every viewer renders mention tokens from structured metadata —
  // display names are re-resolved client-side from the mention rows.
  const mentionRows = await db.spinRoomChatMention.findMany({
    where: { messageId: { in: msgs.map((m) => m.id) } },
    select: { messageId: true, mentionedUserId: true, mentionedByUserId: true },
  })
  const names = await db.user.findMany({
    where: { id: { in: [...new Set(mentionRows.map((r) => r.mentionedUserId))] } },
    select: { id: true, name: true },
  })
  const nameById = new Map(names.map((u) => [u.id, u.name]))
  const mentionsByMessage = new Map<string, { userId: string; displayName: string }[]>()
  for (const r of mentionRows) {
    const list = mentionsByMessage.get(r.messageId) ?? []
    list.push({ userId: r.mentionedUserId, displayName: nameById.get(r.mentionedUserId) ?? 'Player' })
    mentionsByMessage.set(r.messageId, list)
  }
  return NextResponse.json({
    messages: msgs.reverse().map((m) => ({
      id: m.id,
      userId: m.userId,
      text: m.text,
      kind: m.kind,
      createdAt: m.createdAt.toISOString(),
      author: { id: m.user.id, name: m.user.name },
      mentions: mentionsByMessage.get(m.id) ?? [],
    })),
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const roomId = String(body?.roomId ?? '')
  const text = String(body?.text ?? '').trim().slice(0, 280)
  if (!roomId || !text) return NextResponse.json({ error: 'roomId + text required' }, { status: 400 })

  // ── Mentions (§40/§41): NEVER trust client mention data. Each submitted
  // userId must be an ACTIVE member of THIS room; the sender's own id is
  // dropped (§94 — no self-awarded notification events). Unknown/duplicate
  // ids are ignored, not rejected — a stale picker must not break sending.
  const rawMentions: unknown[] = Array.isArray(body?.mentions) ? body.mentions.slice(0, 10) : []
  const wantedMentionIds: string[] = [
    ...new Set(
      rawMentions
        .map((m) => String((m as any)?.userId ?? ''))
        .filter((id) => id && id !== me.id)
    ),
  ]
  const activeMembers = await db.spinRoomPlayer.findMany({
    where: { roomId, leftAt: null, isActive: true },
    select: { userId: true, mentionsEnabled: true },
  })
  const activeIds = new Set(activeMembers.map((m) => m.userId))
  // Room-chat settings: a member with mentionsEnabled=false can NOT be
  // mentioned in THIS room — the mention row is never created, so no
  // notification ever fires (their toolbox hides Mention + the @ picker
  // filters their name on every client; this is the authoritative guard).
  const mentionableIds = new Set(activeMembers.filter((m) => m.mentionsEnabled).map((m) => m.userId))
  const validMentionIds: string[] = wantedMentionIds.filter((id) => activeIds.has(id) && mentionableIds.has(id))

  const member = await db.spinRoomPlayer.findFirst({ where: { roomId, userId: me.id, leftAt: null } })
  if (!member) return NextResponse.json({ error: 'Not in room' }, { status: 403 })

  // Block basic slurs/links for V1 — full moderation in V1.1
  if (/(https?:\/\/|www\.)/i.test(text)) {
    return NextResponse.json({ error: 'Links are not allowed in room chat' }, { status: 400 })
  }

  const last = lastSentAt.get(me.id) ?? 0
  if (Date.now() - last < RATE_LIMIT_MS) {
    return NextResponse.json({ error: 'Slow down a bit' }, { status: 429 })
  }
  lastSentAt.set(me.id, Date.now())

  // §45: message + mention records are ONE transaction — a mention row can
  // never outlive its message or vice versa.
  const { created, mentionRows } = await db.$transaction(async (tx) => {
    const created = await tx.spinRoomMessage.create({
      data: { roomId, userId: me.id, text, kind: 'user' },
      include: { user: { select: { name: true, id: true } } },
    })
    if (validMentionIds.length) {
      await tx.spinRoomChatMention.createMany({
        data: validMentionIds.map((mentionedUserId: string) => ({
          messageId: created.id,
          mentionedUserId,
          mentionedByUserId: me.id,
          roomId,
        })),
      })
    }
    // createMany doesn't return rows (connector-portable) — re-read them so
    // every mention row's id is available for the notification fan-out.
    const mentionRows = validMentionIds.length
      ? await tx.spinRoomChatMention.findMany({ where: { messageId: created.id } })
      : []
    return { created, mentionRows }
  })
  await db.spinRoom.update({ where: { id: roomId }, data: { lastActivityAt: new Date() } })
  // Lifecycle §12: sending a chat message counts as room activity.
  await touchMemberActivity(roomId, me.id).catch(() => {})

  // §45/§50/§53: per-mention notification fan-out. The per-user game-chat
  // stream reaches the mentioned user on ANY Quicky screen (§53) — the room
  // UI never needs to be mounted. Clients dedupe by mention.id (§55).
  const actorName = me.name ?? 'Someone'
  const createdAt = created.createdAt.toISOString()
  for (const row of mentionRows) {
    emitGameChatUser(row.mentionedUserId, {
      type: 'mention',
      mention: {
        id: row.id,
        roomId,
        messageId: created.id,
        actorUserId: me.id,
        actorName,
        textPreview: text.slice(0, 80),
        createdAt,
      },
    })
  }

  const mentionedProfiles = mentionRows.length
    ? await db.user.findMany({
        where: { id: { in: mentionRows.map((r: { mentionedUserId: string }) => r.mentionedUserId) } },
        select: { id: true, name: true },
      })
    : []
  const mentionName = new Map(mentionedProfiles.map((u) => [u.id, u.name]))

  return NextResponse.json({
    ok: true,
    message: {
      id: created.id,
      userId: created.userId,
      text: created.text,
      kind: created.kind,
      createdAt,
      author: { id: created.user.id, name: created.user.name },
      mentions: mentionRows.map((r: { mentionedUserId: string }) => ({
        userId: r.mentionedUserId,
        displayName: mentionName.get(r.mentionedUserId) ?? 'Player',
      })),
    },
  })
}
