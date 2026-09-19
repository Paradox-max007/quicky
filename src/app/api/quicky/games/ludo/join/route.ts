// Quicky — LUDO JOIN (Ludo PRD §5/§6/§56/§71/§93/§97/§98 — REVISED:
// MODE-based matchmaking (2P duel / 4P table) + diagonal seat fill)
// POST /api/quicky/games/ludo/join   body: { mode: 2 | 4 }
//
// Games → Quicky Ludo landing → [mode] → [Play Now] → THIS route → LudoRoom.
// The SERVER is the sole authority on room + seat assignment (§6/§117):
//   Step 1  lifecycle: reclaim abandoned rooms BEFORE hunting for a table
//   Step 2  end any other room membership (single-room invariant)
//   Step 3  find a joinable Ludo room of the REQUESTED MODE (maxPlayers =
//           2 or 4) with a FREE seat in diagonal fill order 1→3→2→4 and
//           claim it race-safely (atomic room+seat creation, P2028 retry,
//           P2003 absorption — see ludo-assignment.ts)
//   Step 4  no candidate → fresh table of that mode (creator = yard 1)
//   Step 5  refresh the WAITING gameState so the lobby board already shows
//           every seated player in their yard (waiting UX)
//   Step 6  start condition BY MODE — 2P: the 2nd joiner arms the 3·2·1
//           countdown; 4P: the table waits ("waiting for players…") until
//           all four are seated, THEN the countdown arms (§56/§97)
//   Step 7  PLAYING rooms never accept anyone (join lock, §98) — a player
//           arriving midway gets a fresh table of their own
//   Step 8  answer with the authoritative snapshot (§93: never a black
//           screen — the client renders "Preparing board…" from it)
import { NextResponse, NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { buildLudoSnapshot } from '@/lib/quicky/ludo-snapshot'
import { emitRoomUpdate } from '@/lib/quicky/spin-events'
import { maybeRunCleanupLazy } from '@/lib/quicky/room-cleanup'
import { endOtherMemberships } from '@/lib/quicky/room-assignment'
import { activeLudoPlayerCount, assignLudoRoomAndSeat, normalizeLudoMode } from '@/lib/quicky/ludo-assignment'
import { scheduleLudoCountdown, seatedLudoPlayers } from '@/lib/quicky/ludo-server'
import { createGameState } from '@/lib/quicky/ludo/rules'
import type { Prisma } from '@prisma/client'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // The table MODE is chosen by the player BEFORE starting (2P duel or a
  // full 4-player table). Anything else falls back to the 2P duel.
  let mode: 2 | 4 = 2
  try {
    const body = (await req.json().catch(() => ({}))) as { mode?: unknown }
    mode = normalizeLudoMode(body?.mode)
  } catch {}

  // Lifecycle §4: reclaim abandoned rooms first.
  maybeRunCleanupLazy()

  const profile = await db.user.findUnique({
    where: { id: me.id },
    select: { name: true, gender: true },
  })

  // 1. End any other active membership for this user (single-room rule).
  await endOtherMemberships(me.id)

  // 2-4. Race-safe, MODE-matched Ludo room assignment with DIAGONAL seat
  // fill (1→3→2→4): the 2nd joiner is always diagonally opposite the 1st.
  const claim = await assignLudoRoomAndSeat(me.id, mode)
  const roomId = claim.roomId

  // Join chip — the SAME room-chat architecture Spin Bottle uses (§35).
  await db.spinRoomMessage.create({
    data: {
      roomId,
      userId: me.id,
      kind: 'join',
      text: `${profile?.name ?? 'Someone'} joined`,
    },
  })
  emitRoomUpdate(roomId) // players_changed — SSE subscribers refresh instantly

  // 5. Keep the WAITING board honest: re-seed the gameState seating so the
  // lobby ALREADY shows every joined player in their yard (waiting UX).
  const roomRow = await db.spinRoom.findUnique({
    where: { id: roomId },
    select: { status: true, maxPlayers: true },
  })
  if (roomRow?.status === 'WAITING') {
    const seated = await seatedLudoPlayers(roomId)
    if (seated.length > 0) {
      await db.spinRoom.updateMany({
        where: { id: roomId, status: 'WAITING' },
        data: { gameState: createGameState(seated) as unknown as Prisma.InputJsonValue },
      })
    }
  }

  // 6. START condition BY MODE (§56/§97 revised): the countdown arms only
  // when the table reaches ITS OWN capacity — 2/2 for a duel, 4/4 for a
  // full table. Until then the room stays WAITING ("waiting for players…")
  // and the room chat stays open for everyone.
  const playersCount = await activeLudoPlayerCount(roomId)
  if (playersCount >= claim.maxPlayers) {
    await db.spinRoom.updateMany({
      where: { id: roomId, singletonStartedAt: { not: null } },
      data: { singletonStartedAt: null },
    })
    await db.spinRoom.updateMany({
      where: { id: roomId, status: 'WAITING' },
      data: { status: 'STARTING', startedAt: new Date(), lastActivityAt: new Date() },
    })
    // In-process countdown timer (lazy ensureLudoRuntime is the safety net).
    scheduleLudoCountdown(roomId)
    emitRoomUpdate(roomId, 'LUDO_COUNTDOWN', { roomId, ms: 3000 })
  }

  const snapshot = await buildLudoSnapshot(roomId, me.id)
  return NextResponse.json({
    ok: true,
    roomId,
    mode: claim.maxPlayers,
    createdNewRoom: claim.createdNewRoom,
    snapshot,
  })
}
