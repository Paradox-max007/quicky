// Quicky — Round response (PRD §27/§28: BOTH the spinner and the target
// answer ❤️ Kiss / 💔 No Thanks independently; first answer locks, second
// answer resolves the round server-side).
// POST /api/quicky/games/spin-bottle/respond { roomId, choice: 'yes' | 'no' }
//
// Bug-fix PRD §29-§38: the SERVER deadline is the only authority. A response
// that reaches this endpoint while server_now <= responseDeadline MUST be
// accepted even if the client countdown already hit zero — the timeout
// watchdog runs with a small grace so the last-moment write always wins the
// race (§30/§33/§35). Errors are SPECIFIC codes (§102), never a generic
// "Already resolved":
//   ALREADY_RESPONDED · ROUND_EXPIRED · NOT_TARGET · ROOM_INACTIVE
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { recordRoundResponse } from '@/lib/quicky/spin-bottle'
import { touchMemberActivity } from '@/lib/quicky/room-activity'

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const roomId = String(body?.roomId ?? '')
  const choice = body?.choice === 'yes' ? 'yes' : body?.choice === 'no' ? 'no' : null
  if (!roomId || !choice) return NextResponse.json({ error: 'roomId + choice required' }, { status: 400 })

  const room = await db.spinRoom.findUnique({ where: { id: roomId } })
  if (!room) return NextResponse.json({ error: 'ROOM_INACTIVE' }, { status: 404 })
  if (!room.currentSpinId) return NextResponse.json({ error: 'NO_ACTIVE_ROUND' }, { status: 400 })
  const spin = await db.spinBottleSpin.findUnique({ where: { id: room.currentSpinId } })
  if (!spin) return NextResponse.json({ error: 'NO_ACTIVE_ROUND' }, { status: 400 })

  // Two-party model: spinner OR target may answer (PRD §28)
  if (spin.spinnerId !== me.id && spin.targetId !== me.id) {
    return NextResponse.json({ error: 'NOT_TARGET' }, { status: 403 })
  }
  // Already answered → locked (PRD §59: no changing the answer). §102: this
  // is a SPECIFIC state — the client keeps its optimistic chip, no error UI.
  const myResponse = spin.spinnerId === me.id ? spin.spinnerResponse : spin.targetResponse
  if (myResponse) return NextResponse.json({ error: 'ALREADY_RESPONDED' }, { status: 409 })

  // §31/§35: the client countdown is DISPLAY-ONLY. The deadline comparison
  // happens HERE, against the server clock. Within the deadline the write
  // below is a conditional update (single-flight) — the timeout watchdog
  // cannot flip the round to completed inside the window because it fires
  // with a grace period AFTER the deadline (spin-bottle.ts GRACE).
  if (spin.status === 'awaiting' && spin.responseDeadline) {
    const late = Date.now() > spin.responseDeadline.getTime()
    if (late) {
      // §33: expired per the server clock — surface the specific code and
      // let the watchdog resolve the round (it fires within the grace ms).
      return NextResponse.json({ error: 'ROUND_EXPIRED' }, { status: 410 })
    }
  } else if (spin.status !== 'awaiting') {
    // Round already resolved by the watchdog/forfeit path and we are past
    // the deadline (grace guarantees no in-window flip) — §101/§102.
    return NextResponse.json({ error: 'ROUND_EXPIRED' }, { status: 410 })
  }

  const outcome = await recordRoundResponse(roomId, spin.id, me.id, choice)
  if (outcome === false) {
    // Lost a microscopic race (another path completed the round between the
    // checks above and the write). Re-derive the SPECIFIC reason (§102).
    const fresh = await db.spinBottleSpin.findUnique({ where: { id: spin.id } })
    const stillMine =
      fresh && (fresh.spinnerId === me.id ? fresh.spinnerResponse : fresh.targetResponse)
    if (stillMine) return NextResponse.json({ error: 'ALREADY_RESPONDED' }, { status: 409 })
    return NextResponse.json({ error: 'ROUND_EXPIRED' }, { status: 410 })
  }
  // Lifecycle §12: choosing Kiss / No Thanks is a valid activity signal.
  await touchMemberActivity(roomId, me.id).catch(() => {})
  return NextResponse.json({ ok: true, outcome })
}
