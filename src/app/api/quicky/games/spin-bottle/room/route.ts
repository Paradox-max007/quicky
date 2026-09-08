// Quicky — Get a room snapshot
// GET /api/quicky/games/spin-bottle/room?roomId=...
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { buildRoomSnapshot } from '@/lib/quicky/spin-snapshot'

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roomId = req.nextUrl.searchParams.get('roomId') ?? ''
  if (!roomId) return NextResponse.json({ error: 'roomId required' }, { status: 400 })

  const snap = await buildRoomSnapshot(roomId, me.id)
  if (!snap) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, snapshot: snap })
}
