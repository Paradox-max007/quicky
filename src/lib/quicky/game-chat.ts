// Quicky — GAME CHAT server helpers (game-chat PRD §10/§11/§16/§24/§125)
//
// Conversation identity: a deterministic canonical pair (userAId < userBId)
// so conversation(A,B) resolves to EXACTLY one row (§11). Opening a profile
// → Message never persists anything until the first message is actually
// sent (§10). All reads verify membership (§125) — a user can never touch a
// conversation they are not part of.
import { db } from '@/lib/db'
import type { Prisma, GameMessage, GameMessageReaction } from '@prisma/client'

export const MESSAGE_PAGE_SIZE = 40

export function canonicalPair(a: string, b: string): { userAId: string; userBId: string } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a }
}

/** Resolve WITHOUT creating (§10 — no empty conversations in the DB). */
export async function resolveConversation(userId: string, peerId: string) {
  if (userId === peerId) return null
  const { userAId, userBId } = canonicalPair(userId, peerId)
  return db.gameConversation.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
  })
}

/** Get-or-create inside a race-safe upsert; members ensured afterwards. */
export async function getOrCreateConversation(userId: string, peerId: string) {
  if (userId === peerId) return null
  const { userAId, userBId } = canonicalPair(userId, peerId)
  const conversation = await db.gameConversation.upsert({
    where: { userAId_userBId: { userAId, userBId } },
    update: {},
    create: { userAId, userBId },
  })
  await ensureMembers(conversation.id, [userId, peerId])
  return conversation
}

export async function ensureMembers(conversationId: string, userIds: string[]) {
  // Unique (conversationId, userId) makes duplicates impossible; SQLite has
  // no skipDuplicates, so races are absorbed via the constraint + catch.
  await db.gameConversationMember
    .createMany({ data: userIds.map((userId) => ({ conversationId, userId })) })
    .catch(() => {})
}

/** The OTHER member of a 1-to-1 conversation. */
export function otherMemberId(conversation: { userAId: string; userBId: string }, meId: string): string {
  return conversation.userAId === meId ? conversation.userBId : conversation.userAId
}

export async function amIMember(conversationId: string, userId: string) {
  const m = await db.gameConversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { lastReadAt: true },
  })
  return m
}

export type SerializedMessage = {
  id: string
  conversationId: string
  senderId: string
  messageType: string
  text: string | null
  stickerId: string | null
  sticker: { id: string; name: string; assetUrl: string } | null
  replyToMessageId: string | null
  replyTo: { id: string; senderId: string; senderName: string | null; text: string; messageType: string } | null
  clientMessageId: string | null
  createdAt: string
  reactions: { reaction: string; userIds: string[] }[]
}

/** Message → wire shape (with reply preview + grouped reactions, §27/§31). */
export async function serializeMessages(rows: (GameMessage & { reactions: GameMessageReaction[]; sticker: { id: string; name: string; assetUrl: string } | null })[]): Promise<SerializedMessage[]> {
  if (rows.length === 0) return []
  // Resolve reply previews in ONE query for the whole page.
  const replyIds = rows.map((r) => r.replyToMessageId).filter((v): v is string => !!v)
  const replies = replyIds.length
    ? await db.gameMessage.findMany({
        where: { id: { in: replyIds } },
        select: { id: true, senderId: true, text: true, messageType: true, sender: { select: { name: true } } },
      })
    : []
  const replyMap = new Map(replies.map((r) => [r.id, r]))

  return rows.map((m) => {
    const grouped = new Map<string, string[]>()
    for (const r of m.reactions) {
      const list = grouped.get(r.reaction) ?? []
      list.push(r.userId)
      grouped.set(r.reaction, list)
    }
    const ref = m.replyToMessageId ? replyMap.get(m.replyToMessageId) : null
    return {
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      messageType: m.messageType,
      text: m.text,
      stickerId: m.stickerId,
      sticker: m.sticker ? { id: m.sticker.id, name: m.sticker.name, assetUrl: m.sticker.assetUrl } : null,
      replyToMessageId: m.replyToMessageId,
      replyTo: ref
        ? {
            id: ref.id,
            senderId: ref.senderId,
            senderName: ref.sender?.name ?? null,
            text: ref.text ?? (ref.messageType === 'sticker' ? '🎁 Sticker' : ''),
            messageType: ref.messageType,
          }
        : null,
      clientMessageId: m.clientMessageId,
      createdAt: m.createdAt.toISOString(),
      reactions: Array.from(grouped.entries()).map(([reaction, userIds]) => ({ reaction, userIds })),
    }
  })
}

/** Peer display info for headers / chat list rows (§33/§87). */
export async function peerInfo(peerId: string) {
  const u = await db.user.findUnique({
    where: { id: peerId },
    select: {
      id: true,
      name: true,
      photos: { orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }], take: 4, select: { url: true, isPrivate: true } },
    },
  })
  if (!u) return { id: peerId, name: null as string | null, avatar: null as string | null }
  const photo = u.photos.find((p) => !p.isPrivate) ?? u.photos[0] ?? null
  return { id: u.id, name: u.name, avatar: photo?.url ?? null }
}

/** Unread count for MY side of a conversation (§89). */
export async function unreadCount(conversationId: string, meId: string, lastReadAt: Date, peerId: string) {
  return db.gameMessage.count({
    where: {
      conversationId,
      senderId: peerId,
      deletedAt: null,
      createdAt: { gt: lastReadAt },
    },
  })
}

/** Cursor-paginated page for a conversation (§24 — latest page first). */
export async function loadPage(conversationId: string, before?: string | null) {
  const rows = await db.gameMessage.findMany({
    where: {
      conversationId,
      deletedAt: null,
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    take: MESSAGE_PAGE_SIZE,
    include: { reactions: true, sticker: { select: { id: true, name: true, assetUrl: true } } },
  })
  // Latest page is fetched DESC — return ASC for rendering (§23).
  return rows.reverse()
}

export function jsonError(error: string, status = 400) {
  return Response.json({ error }, { status })
}

export type { Prisma }
