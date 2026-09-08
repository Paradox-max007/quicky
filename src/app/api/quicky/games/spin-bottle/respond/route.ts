// Quicky — Kiss yes/no response
// POST /api/quicky/games/spin-bottle/respond { roomId, choice: 'yes' | 'no' }
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import { recordKissResponse } from '@/lib/quicky/spin-bottle'

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
  if (spin.targetId !== me.id) return NextResponse.json({ error: 'Not your turn to respond' }, { status: 403 })
  if (spin.status !== 'awaiting') return NextResponse.json({ error: 'Already resolved' }, { status: 409 })

  const ok = await recordKissResponse(roomId, spin.id, choice)
  return NextResponse.json({ ok })
}
