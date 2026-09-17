// Quicky — LUDO GAME-STATE STREAM (Ludo PRD §52/§53/§55/§114)
// GET /api/quicky/games/ludo/stream?roomId=...
//
// Server-Sent Events over the SHARED room event bus (spin-events.ts — the
// roomId-keyed bus every room game publishes to; Ludo PRD §52: "use the
// existing realtime architecture"). Every connected room member receives a
// FRESH authoritative snapshot on every engine transition plus the typed
// LUDO_* signals (LUDO_DICE_ROLLED, LUDO_TOKEN_MOVED, LUDO_PLAYER_LEFT,
// LUDO_GAME_FINISHED, …) that drive identical animations on every client
// (§55: never animate only on the acting user's device).
import { NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { buildLudoSnapshot } from '@/lib/quicky/ludo-snapshot'
import { subscribeRoom } from '@/lib/quicky/spin-events'
import { ensureLudoRuntime } from '@/lib/quicky/ludo-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return new Response('Unauthorized', { status: 401 })
  const roomId = req.nextUrl.searchParams.get('roomId') ?? ''
  if (!roomId) return new Response('roomId required', { status: 400 })

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let sendTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          // controller already closed — client vanished
        }
      }

      const pushSnapshot = async () => {
        if (closed) return
        try {
          const snap = await buildLudoSnapshot(roomId, me.id)
          if (!snap) {
            send('room_gone', { roomId })
            cleanup()
            return
          }
          send('snapshot', snap)
        } catch {
          // transient DB error — keep the stream alive, recovery poll covers it
        }
      }

      const scheduleSnapshot = (event = 'ROOM_UPDATED', payload?: unknown) => {
        // Typed LUDO_* events are forwarded AS THEY HAPPEN; the fresh
        // authoritative snapshot follows right behind (§52/§114).
        if (event !== 'ROOM_UPDATED') send('room_event', { event, payload })
        if (closed || sendTimer) return
        // Coalesce bursts (multiple emits inside one transaction window)
        sendTimer = setTimeout(() => {
          sendTimer = null
          pushSnapshot()
        }, 60)
      }

      const cleanup = () => {
        if (closed) return
        closed = true
        unsubscribe?.()
        if (heartbeat) clearInterval(heartbeat)
        if (sendTimer) clearTimeout(sendTimer)
        try {
          controller.close()
        } catch {}
      }

      // Heal a room stuck in STARTING/PLAYING before the first snapshot.
      await ensureLudoRuntime(roomId).catch(() => {})
      await pushSnapshot()
      unsubscribe = subscribeRoom(roomId, scheduleSnapshot)

      // Keep intermediaries from closing the idle connection
      heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`))
        } catch {
          cleanup()
        }
      }, 20000)

      req.signal.addEventListener('abort', cleanup)
    },
    cancel() {
      closed = true
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
      if (sendTimer) clearTimeout(sendTimer)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
