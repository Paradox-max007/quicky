// Quicky — server-side snapshot builder for a Spin the Bottle room.
// Returns the shape the client expects on every poll/refresh.
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
    response: string | null
  } | null
  myTurnIndex: number
  myTurnIs: boolean
  iAmTarget: boolean
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
    }
  })

  // currentSpin
  const spin = room.currentSpinId
    ? await db.spinBottleSpin.findUnique({ where: { id: room.currentSpinId } })
    : null
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
      }
    : null

  // Recent chat (last 80)
  const msgs = await db.spinRoomMessage.findMany({
    where: { roomId },
    orderBy: { createdAt: 'desc' },
    take: 80,
  })
  const recentMessages = msgs
    .reverse()
    .map((m) => ({ id: m.id, userId: m.userId, text: m.text, kind: m.kind, createdAt: m.createdAt.toISOString() }))

  // myTurnIs / iAmTarget
  const me = players.find((p) => p.userId === viewerId)
  const myTurnIndex = me?.turnIndex ?? -1
  const myTurnIs = currentSpin?.spinnerId === viewerId && currentSpin?.status === 'spinning'
  const iAmTarget = currentSpin?.targetId === viewerId && currentSpin?.status === 'awaiting'

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
    recentMessages,
  }
}
