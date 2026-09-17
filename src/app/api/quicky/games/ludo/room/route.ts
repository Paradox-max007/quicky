// Quicky — LUDO ROOM STATE (Ludo PRD §52/§63/§89/§114)
// GET /api/quicky/games/ludo/room?roomId=...
//
// The recovery/reconcile endpoint: the authoritative snapshot for a room.
// Used by the client store's recovery poll (stream-down only), Capacitor
// resume (§63: reconnect → fetch latest state → compare version → reconcile
// board) and the room-restore-after-refresh path. Lazy runtime recovery runs
// here too, so a room stuck in STARTING heals on the next fetch.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { buildLudoSnapshot } from '@/lib/quicky/ludo-snapshot'
import { ensureLudoRuntime } from '@/lib/quicky/ludo-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roomId = req.nextUrl.searchParams.get('roomId') ?? ''
  if (!roomId) return NextResponse.json({ error: 'roomId required' }, { status: 400 })

  await ensureLudoRuntime(roomId).catch(() => {})

  const snapshot = await buildLudoSnapshot(roomId, me.id)
  if (!snapshot) return NextResponse.json({ error: 'Room not found', closed: true }, { status: 404 })
  return NextResponse.json({ ok: true, snapshot })
}
