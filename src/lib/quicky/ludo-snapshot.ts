// Quicky — LUDO ROOM SNAPSHOT (Ludo PRD §45/§52/§114)
//
// Server-side builder for the state every Ludo client receives on stream
// push / poll / reconcile. Mirrors buildRoomSnapshot (spin-bottle) so the
// two room games stay architecturally identical — but it carries the FULL
// authoritative LudoGameState (Ludo has no hidden information to mask).
// Clients diff `game.version` (§51/§114): a gap → request this snapshot.

import { db } from '@/lib/db'
import { colorForSeat } from './ludo/constants'
import { parseGiftMetadata, type RoomSnapshot } from './spin-snapshot'
import type { LudoGameState } from './ludo/types'

export type LudoPlayerSummary = {
  userId: string
  seatIndex: number
  color: string
  turnIndex: number
  connection: string
  isActive: boolean
  displayName: string
  avatar: string | null
  gender: string | null
  tokensFinished: number
  captures: number
  /** Present in the authoritative game state (playing/waiting rooms). */
  inGame: boolean
  gameStatus: string | null
  /** Room-chat mention privacy: false → nobody in THIS room can mention
   *  this player (toolbox + picker + server-side mention filtering). */
  mentionsEnabled: boolean
}

export type LudoRoomSnapshot = {
  roomId: string
  /** Room lifecycle status: WAITING | STARTING | PLAYING | CLOSING. */
  status: string
  gameType: 'ludo'
  maxPlayers: number
  minPlayers: number
  singletonStartedAt: string | null
  players: LudoPlayerSummary[]
  /** The authoritative game (§45) — null only before the first write. */
  game: LudoGameState | null
  /** VIEWER-relative helpers (rendering only; server stays authoritative). */
  me: {
    seatIndex: number | null
    color: string | null
    isCurrentPlayer: boolean
    inGame: boolean
  }
  serverNow: number
  viewer: { coinBalance: number; kissPoints: number; giftsReceived: number }
  recentMessages: RoomSnapshot['recentMessages']
}

/** A member whose ping is older than this renders as disconnected (§42). */
const DISCONNECTED_AFTER_MS = 35_000

export async function buildLudoSnapshot(roomId: string, viewerId: string): Promise<LudoRoomSnapshot | null> {
  // INSTANT REALTIME: every independent query runs in PARALLEL — the old
  // 5-6 sequential round-trips (room → messages → mentions → names → viewer
  // → gifts) took 2-3s through the pooled connection and delayed every
  // other player's view of a move. Only the mention joins wait on messages.
  const [room, msgs, viewerUser, giftsReceivedAgg] = await Promise.all([
    db.spinRoom.findUnique({
      where: { id: roomId },
      include: {
        players: {
          where: { leftAt: null },
          orderBy: [{ seatIndex: 'asc' }],
          include: {
            user: {
              select: {
                id: true,
                name: true,
                gender: true,
                kissPoints: true,
                photos: {
                  orderBy: [{ position: 'asc' }],
                  select: { url: true, isPrimary: true, isPrivate: true, position: true },
                },
              },
            },
          },
        },
      },
    }),
    db.spinRoomMessage.findMany({
      where: { roomId, kind: { in: ['user', 'join', 'leave', 'gift'] } },
      orderBy: { createdAt: 'desc' },
      take: 80,
    }),
    db.user.findUnique({ where: { id: viewerId }, select: { coinBalance: true, kissPoints: true } }),
    db.spinRoomGift.aggregate({ where: { recipientId: viewerId }, _sum: { quantity: true } }),
  ])
  if (!room || room.gameType !== 'ludo') return null

  const activeRows = room.players.filter((p) => p.isActive)
  const game = (room.gameState as LudoGameState | null) ?? null
  const now = Date.now()

  const players: LudoPlayerSummary[] = activeRows.map((p) => {
    const photo = p.user.photos.find((ph) => !ph.isPrivate) ?? p.user.photos[0]
    const gp = game?.players.find((gp) => gp.userId === p.userId) ?? null
    // Presence: the DB connection field + ping freshness (§42 — a lost
    // connection renders as disconnected without destroying the seat).
    const stale = now - p.lastActivityAt.getTime() > DISCONNECTED_AFTER_MS
    const connection = p.leftAt || !p.isActive ? 'offline' : stale ? 'offline' : p.connection
    return {
      userId: p.userId,
      seatIndex: p.seatIndex,
      color: colorForSeat(p.seatIndex),
      turnIndex: p.turnIndex,
      connection,
      isActive: p.isActive,
      displayName: p.user.name ?? 'Player',
      avatar: photo?.url ?? null,
      gender: p.user.gender,
      tokensFinished: gp?.tokensFinished ?? 0,
      captures: gp?.captures ?? 0,
      inGame: !!gp && gp.status !== 'left',
      gameStatus: gp?.status ?? null,
      mentionsEnabled: p.mentionsEnabled,
    }
  })

  const meRow = activeRows.find((p) => p.userId === viewerId)
  const meGame = game?.players.find((p) => p.userId === viewerId) ?? null

  // Recent chat (last 80) — the SAME room-chat storage Spin Bottle uses
  // (Ludo PRD §35/§79: no duplicated chat architecture), user/join/leave +
  // gift cards (gifting-revision: the gift rows render as the special
  // "You received N × 🎁" card with a send-back button).
  // Mentions depend on `msgs`, so they run as two tight follow-ups (usually
  // zero: rooms with no mentions touch nothing).
  const mentionRows = msgs.length > 0
    ? await db.spinRoomChatMention.findMany({
        where: { messageId: { in: msgs.map((m) => m.id) } },
        select: { messageId: true, mentionedUserId: true },
      })
    : []
  const mentionNames = mentionRows.length > 0
    ? await db.user.findMany({
        where: { id: { in: [...new Set(mentionRows.map((r) => r.mentionedUserId))] } },
        select: { id: true, name: true },
      })
    : []
  const mentionNameById = new Map(mentionNames.map((u) => [u.id, u.name]))
  const mentionsByMsgId = new Map<string, { userId: string; displayName: string }[]>()
  for (const r of mentionRows) {
    const list = mentionsByMsgId.get(r.messageId) ?? []
    list.push({ userId: r.mentionedUserId, displayName: mentionNameById.get(r.mentionedUserId) ?? 'Player' })
    mentionsByMsgId.set(r.messageId, list)
  }
  const recentMessages = msgs
    .reverse()
    .map((m) => ({
      id: m.id,
      userId: m.userId,
      text: m.text,
      kind: m.kind,
      createdAt: m.createdAt.toISOString(),
      mentions: mentionsByMsgId.get(m.id) ?? [],
      metadata: parseGiftMetadata(m.metadata),
    }))

  return {
    roomId: room.id,
    status: room.status,
    gameType: 'ludo',
    maxPlayers: room.maxPlayers,
    minPlayers: room.minPlayers,
    singletonStartedAt: room.singletonStartedAt?.toISOString() ?? null,
    players,
    game,
    me: {
      seatIndex: meRow?.seatIndex ?? null,
      color: meRow ? colorForSeat(meRow.seatIndex) : null,
      isCurrentPlayer: !!meRow && game?.currentPlayerId === viewerId && game?.status === 'playing',
      inGame: !!meGame && meGame.status !== 'left',
    },
    serverNow: now,
    viewer: {
      coinBalance: viewerUser?.coinBalance ?? 0,
      kissPoints: viewerUser?.kissPoints ?? 0,
      giftsReceived: giftsReceivedAgg._sum.quantity ?? 0,
    },
    recentMessages,
  }
}
