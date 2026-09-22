// Quicky — server-side snapshot builder for a Spin the Bottle room (PRD v2).
// Returns the shape the client expects on every stream push / poll / refresh.
//
// Privacy (PRD §28): while a round is still awaiting, a participant's choice
// is only visible to THEMSELF — everyone else (including spectators) gets
// nulls until the round is completed and the server publishes the result.
import { db } from '@/lib/db'
import { normalizeGender, seatGenderForIndex } from './room-assignment'

export type RoomPlayerSummary = {
  userId: string
  seatIndex: number
  turnIndex: number
  connection: string
  isActive: boolean
  displayName: string
  avatar: string | null
  gender: string | null
  kissPoints: number
  /** Room-chat mention privacy: false → nobody in THIS room can mention
   *  this player (toolbox + picker + server-side mention filtering). */
  mentionsEnabled: boolean
}

export type RoomSnapshot = {
  roomId: string
  status: string
  maxPlayers: number
  minPlayers: number
  currentTurnIdx: number
  /**
   * Lifecycle PRD §6/§23 — when the room has exactly one active player this
   * is when that state began (ISO). The client renders a gentle "table closes
   * in ~mm:ss" hint from it; the cleanup worker enforces the real deadline.
   */
  singletonStartedAt: string | null
  players: RoomPlayerSummary[]
  /**
   * Games PRD §11/§73 — server-authoritative spin gate, mirrored to the
   * client for RENDERING only (the server re-checks before every spin):
   * canSpin = totalPlayers > 1 && maleCount > 0 && femaleCount > 0.
   * Gender counts are aggregate only — the UI never labels a seat or a
   * waiting state with gender wording (§5/§13).
   */
  canSpin: boolean
  maleCount: number
  femaleCount: number
  currentSpin: {
    id: string
    spinnerId: string
    targetId: string | null
    startRotation: number
    endRotation: number
    duration: number
    status: string
    /** Legacy V1 single-answer field — always null on new rounds. */
    response: string | null
    /**
     * Two-party responses. Masked until the round completes: each viewer
     * sees their OWN answer only; after completion both are published.
     * "yes" | "no" | "timeout" | null
     */
    spinnerResponse: string | null
    targetResponse: string | null
    /** "mutual_kiss" | "partial_kiss" | "full_rejection" — server-computed. */
    result: string | null
    /** ISO deadline of the 10s response window (server clock, PRD §29). */
    responseDeadline: string | null
  } | null
  myTurnIndex: number
  myTurnIs: boolean
  iAmTarget: boolean
  /** Viewer is the current round's spinner (responds too, PRD §28). */
  iAmSpinner: boolean
  /** Server wall clock (ms) — clients compute remaining = deadline − now. */
  serverNow: number
  /**
   * The VIEWER's economy (v3 PRD §19-§25): the authoritative numbers the room
   * HUD renders. Server wins on every snapshot — optimistic HUD bumps are
   * reconciled against this on the next push.
   */
  viewer: { coinBalance: number; kissPoints: number; giftsReceived: number }
  recentMessages: {
    id: string
    userId: string
    text: string
    kind: string
    createdAt: string
    mentions?: { userId: string; displayName: string }[]
    /** kind === 'gift' rows carry the gift payload (icon/name/quantity/
     *  recipients) parsed from the DB JSON — drives the special gift card. */
    metadata?: {
      itemId?: string
      itemName?: string
      itemEmoji?: string
      itemIcon?: string
      itemIconType?: string
      recipientId?: string | null
      recipientName?: string | null
      recipientIds?: string[]
      recipientNames?: string[]
      recipientCount?: number
      quantity?: number
      bulk?: boolean
    } | null
  }[]
}

// Room-lifecycle closure dialog kept in room.ts — snapshot helpers below.

/** Parse a gift row's JSON metadata (defensive — a corrupt row renders as
 *  a plain legacy chip instead of exploding the whole snapshot). */
export function parseGiftMetadata(raw: string | null): RoomSnapshot['recentMessages'][number]['metadata'] {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    if (!v || typeof v !== 'object') return null
    return {
      itemId: typeof v.itemId === 'string' ? v.itemId : undefined,
      itemName: typeof v.itemName === 'string' ? v.itemName : undefined,
      itemEmoji: typeof v.itemEmoji === 'string' ? v.itemEmoji : undefined,
      itemIcon: typeof v.itemIcon === 'string' ? v.itemIcon : undefined,
      itemIconType: typeof v.itemIconType === 'string' ? v.itemIconType : undefined,
      recipientId: typeof v.recipientId === 'string' ? v.recipientId : null,
      recipientName: typeof v.recipientName === 'string' ? v.recipientName : null,
      recipientIds: Array.isArray(v.recipientIds) ? v.recipientIds.filter((x: unknown) => typeof x === 'string') : [],
      recipientNames: Array.isArray(v.recipientNames) ? v.recipientNames.filter((x: unknown) => typeof x === 'string') : [],
      recipientCount: Number.isFinite(v.recipientCount) ? v.recipientCount : undefined,
      quantity: Number.isFinite(v.quantity) ? v.quantity : undefined,
      bulk: !!v.bulk,
    }
  } catch {
    return null
  }
}

export async function buildRoomSnapshot(roomId: string, viewerId: string): Promise<RoomSnapshot | null> {
  const room = await db.spinRoom.findUnique({
    where: { id: roomId },
    include: {
      players: {
        where: { leftAt: null },
        orderBy: [{ turnIndex: 'asc' }],
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
  })
  if (!room) return null

  // Sort by turnIndex (so the active rotation is stable)
  const activePlayers = room.players
    .filter((p) => p.isActive)
    .sort((a, b) => a.turnIndex - b.turnIndex)

  const players: RoomPlayerSummary[] = activePlayers.map((p) => {
    const photo = p.user.photos.find((ph) => !ph.isPrivate) ?? p.user.photos[0]
    return {
      userId: p.userId,
      seatIndex: p.seatIndex,
      turnIndex: p.turnIndex,
      connection: p.connection,
      isActive: p.isActive,
      displayName: p.user.name ?? 'Someone',
      avatar: photo?.url ?? null,
      gender: p.user.gender,
      kissPoints: p.user.kissPoints,
      mentionsEnabled: p.mentionsEnabled,
    }
  })

  // currentSpin
  const spin = room.currentSpinId
    ? await db.spinBottleSpin.findUnique({ where: { id: room.currentSpinId } })
    : null
  const completed = spin?.status === 'completed'
  const viewerIsSpinner = spin?.spinnerId === viewerId
  const viewerIsTarget = spin?.targetId === viewerId
  const currentSpin = spin
    ? {
        id: spin.id,
        spinnerId: spin.spinnerId,
        targetId: spin.targetId,
        startRotation: spin.startRotation,
        endRotation: spin.endRotation,
        duration: spin.duration,
        status: spin.status,
        response: spin.response,
        // Mask responses until the round resolves (see file header)
        spinnerResponse: completed || viewerIsSpinner ? spin.spinnerResponse : null,
        targetResponse: completed || viewerIsTarget ? spin.targetResponse : null,
        result: completed ? spin.result : null,
        responseDeadline: spin.responseDeadline?.toISOString() ?? null,
      }
    : null

  // Recent chat (last 80) — v2.1 §48/§56: real user messages, join/leave
  // chips AND gift cards (gifting-revision: the aggregated gift rows render
  // as the special "You received N × 🎁 from …" card with a send-back
  // button). Legacy game/system log rows stay filtered out.
  const msgs = await db.spinRoomMessage.findMany({
    where: { roomId, kind: { in: ['user', 'join', 'leave', 'gift'] } },
    orderBy: { createdAt: 'desc' },
    take: 80,
  })
  // §56: mention metadata rides with every snapshot so a fresh client (or a
  // stream reconnect) still renders "@Name" tokens correctly.
  const mentionRows = await db.spinRoomChatMention.findMany({
    where: { messageId: { in: msgs.map((m) => m.id) } },
    select: { messageId: true, mentionedUserId: true },
  })
  const mentionNames = mentionRows.length
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

  // myTurnIs / iAmTarget / iAmSpinner
  const me = players.find((p) => p.userId === viewerId)
  const myTurnIndex = me?.turnIndex ?? -1
  const myTurnIs = currentSpin?.spinnerId === viewerId && currentSpin?.status === 'spinning'
  const iAmTarget = currentSpin?.targetId === viewerId && currentSpin?.status === 'awaiting'
  const iAmSpinner = currentSpin?.spinnerId === viewerId && currentSpin?.status === 'awaiting'

  // Spin gate mirror (§11/§73) — effective seat gender = profile gender when
  // it maps cleanly, else the gender slot of the occupied seat.
  const effective = (p: RoomPlayerSummary) =>
    normalizeGender(p.gender) ?? seatGenderForIndex(p.seatIndex)
  const maleCount = players.filter((p) => effective(p) === 'male').length
  const femaleCount = players.filter((p) => effective(p) === 'female').length
  const canSpin = players.length > 1 && maleCount > 0 && femaleCount > 0

  // Viewer economy (v3 §19-§25): balance + gifts received in one query each,
  // kiss points come from the player row already fetched above.
  const [viewerUser, giftsReceivedAgg] = await Promise.all([
    db.user.findUnique({ where: { id: viewerId }, select: { coinBalance: true, kissPoints: true } }),
    db.spinRoomGift.aggregate({ where: { recipientId: viewerId }, _sum: { quantity: true } }),
  ])

  return {
    roomId: room.id,
    status: room.status,
    maxPlayers: room.maxPlayers,
    minPlayers: room.minPlayers,
    currentTurnIdx: room.currentTurnIdx,
    singletonStartedAt: room.singletonStartedAt?.toISOString() ?? null,
    players,
    canSpin,
    maleCount,
    femaleCount,
    currentSpin,
    myTurnIndex,
    myTurnIs,
    iAmTarget,
    iAmSpinner,
    serverNow: Date.now(),
    viewer: {
      coinBalance: viewerUser?.coinBalance ?? 0,
      kissPoints: viewerUser?.kissPoints ?? me?.kissPoints ?? 0,
      giftsReceived: giftsReceivedAgg._sum.quantity ?? 0,
    },
    recentMessages,
  }
}
