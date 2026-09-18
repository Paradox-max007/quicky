// Quicky — LUDO JOIN (Ludo PRD §5/§6/§56/§71/§93/§97/§98 — REVISED: the
// join checks table availability AND the 2-male/2-female gender weighting)
// POST /api/quicky/games/ludo/join
//
// Games → Quicky Ludo landing → [Play Now] → THIS route → LudoRoom.
// The SERVER is the sole authority on room + seat assignment (§6/§117):
//   Step 1  lifecycle: reclaim abandoned rooms BEFORE hunting for a table
//   Step 2  end any other room membership (single-room invariant)
//   Step 3  find a joinable Ludo room (WAITING/STARTING only — §98) with a
//           FREE seat in the user's GENDER SLOT (2 male + 2 female per
//           table — even seats = male, odd = female) and claim it
//           race-safely (seat 0=RED 1=GREEN 2=YELLOW 3=BLUE)
//   Step 4  no candidate → fresh gender-weighted 4-seat room
//   Step 5  ≥ 2 players → clear the singleton timer + arm the 3s countdown
//           (STARTING → PLAYING via ensureLudoRuntime, §56/§97)
//   Step 6  answer with the authoritative snapshot (§93: never a black
//           screen — the client renders "Preparing board…" from it)
import { NextResponse, NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { buildLudoSnapshot } from '@/lib/quicky/ludo-snapshot'
import { emitRoomUpdate } from '@/lib/quicky/spin-events'
import { maybeRunCleanupLazy } from '@/lib/quicky/room-cleanup'
import { endOtherMemberships } from '@/lib/quicky/room-assignment'
import { activeLudoPlayerCount, assignLudoRoomAndSeat } from '@/lib/quicky/ludo-assignment'
import { scheduleLudoCountdown } from '@/lib/quicky/ludo-server'

export async function POST(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Lifecycle §4: reclaim abandoned rooms first.
  maybeRunCleanupLazy()

  const profile = await db.user.findUnique({
    where: { id: me.id },
    select: { name: true, gender: true },
  })

  // 1. End any other active membership for this user (single-room rule).
  await endOtherMemberships(me.id)

  // 2-4. Race-safe, gender-weighted Ludo room assignment (2 male + 2 female
  // seats per table; "either" profiles may take any open seat).
  const claim = await assignLudoRoomAndSeat(me.id, profile?.gender ?? null)
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

  // 5. ≥ 2 active players → lobby arms the start countdown (§56/§97).
  const playersCount = await activeLudoPlayerCount(roomId)
  if (playersCount >= 2) {
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
  return NextResponse.json({ ok: true, roomId, createdNewRoom: claim.createdNewRoom, snapshot })
}
