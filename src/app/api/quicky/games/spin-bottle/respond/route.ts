// Quicky — Round response (PRD §27/§28: BOTH the spinner and the target
// answer ❤️ Kiss / 💔 No Thanks independently; first answer locks, second
// answer resolves the round server-side).
// POST /api/quicky/games/spin-bottle/respond { roomId, choice: 'yes' | 'no' }
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
  if (!room?.currentSpinId) return NextResponse.json({ error: 'No active spin' }, { status: 400 })
  const spin = await db.spinBottleSpin.findUnique({ where: { id: room.currentSpinId } })
  if (!spin) return NextResponse.json({ error: 'No active spin' }, { status: 400 })
  if (spin.status !== 'awaiting') return NextResponse.json({ error: 'Already resolved' }, { status: 409 })

  // Two-party model: spinner OR target may answer (PRD §28)
  if (spin.spinnerId !== me.id && spin.targetId !== me.id) {
    return NextResponse.json({ error: 'Not your turn to respond' }, { status: 403 })
  }
  // Already answered → locked (PRD §59: no changing the answer)
  if (spin.spinnerId === me.id && spin.spinnerResponse) {
    return NextResponse.json({ error: 'Your response is locked' }, { status: 409 })
  }
  if (spin.targetId === me.id && spin.targetResponse) {
    return NextResponse.json({ error: 'Your response is locked' }, { status: 409 })
  }

  const outcome = await recordRoundResponse(roomId, spin.id, me.id, choice)
  if (outcome === false) return NextResponse.json({ error: 'Round no longer accepting responses' }, { status: 409 })
  // Lifecycle §12: choosing Kiss / No Thanks is a valid activity signal.
  await touchMemberActivity(roomId, me.id).catch(() => {})
  return NextResponse.json({ ok: true, outcome })
}
