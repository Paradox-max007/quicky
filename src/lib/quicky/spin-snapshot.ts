// Quicky — server-side snapshot builder for a Spin the Bottle room (PRD v2).
// Returns the shape the client expects on every stream push / poll / refresh.
//
// Privacy (PRD §28): while a round is still awaiting, a participant's choice
// is only visible to THEMSELF — everyone else (including spectators) gets
// nulls until the round is completed and the server publishes the result.
import { db } from '@/lib/db'

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
}

export type RoomSnapshot = {
  roomId: string
  status: string
  maxPlayers: number
  minPlayers: number
  currentTurnIdx: number
  players: RoomPlayerSummary[]
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
  recentMessages: { id: string; userId: string; text: string; kind: string; createdAt: string }[]
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

  // Recent chat (last 80) — v2.1 §48/§56: ONLY real user messages and
  // join/leave chips. Legacy game/system log rows in the DB are filtered
  // out here so old records can never flood the chat.
  const msgs = await db.spinRoomMessage.findMany({
    where: { roomId, kind: { in: ['user', 'join', 'leave'] } },
    orderBy: { createdAt: 'desc' },
    take: 80,
  })
  const recentMessages = msgs
    .reverse()
    .map((m) => ({ id: m.id, userId: m.userId, text: m.text, kind: m.kind, createdAt: m.createdAt.toISOString() }))

  // myTurnIs / iAmTarget / iAmSpinner
  const me = players.find((p) => p.userId === viewerId)
  const myTurnIndex = me?.turnIndex ?? -1
  const myTurnIs = currentSpin?.spinnerId === viewerId && currentSpin?.status === 'spinning'
  const iAmTarget = currentSpin?.targetId === viewerId && currentSpin?.status === 'awaiting'
  const iAmSpinner = currentSpin?.spinnerId === viewerId && currentSpin?.status === 'awaiting'

  return {
    roomId: room.id,
    status: room.status,
    maxPlayers: room.maxPlayers,
    minPlayers: room.minPlayers,
    currentTurnIdx: room.currentTurnIdx,
    players,
    currentSpin,
    myTurnIndex,
    myTurnIs,
    iAmTarget,
    iAmSpinner,
    serverNow: Date.now(),
    recentMessages,
  }
}
