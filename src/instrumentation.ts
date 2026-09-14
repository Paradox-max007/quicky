// Next.js instrumentation hook — starts the Spin the Bottle ROOM LIFECYCLE
// CLEANUP WORKER (lifecycle PRD §23/§24) exactly once per Node.js server
// process.
//
// Why here: room cleanup must never depend on a user's device or a React
// timer. This hook runs server-side on boot (dev + production, standalone
// output included), registering a 30-second sweep that:
//   1. auto-leaves members idle ≥ 10 minutes (round-safe, §16),
//   2. deletes empty rooms immediately (§17),
//   3. deletes rooms alone at ≥ 5 minutes using the DB timestamp
//      singleton_started_at (§5/§6/§23),
//   4. reclaims stale CLOSING rooms and prunes closure receipts.
//
// If the process restarts, the next boot re-registers — the timers live in
// the DATABASE, so no state is lost.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const g = globalThis as unknown as { __quickyCleanupWorkerStarted?: boolean }
  if (g.__quickyCleanupWorkerStarted) return
  g.__quickyCleanupWorkerStarted = true

  const { runRoomCleanup } = await import('./lib/quicky/room-cleanup')
  const intervalS = Number(process.env.CLEANUP_INTERVAL_S)

  const tick = () => {
    runRoomCleanup()
      .then((s) => {
        if (
          s.removedInactive +
            s.deletedEmptyRooms +
            s.deletedSingletonRooms +
            s.deletedStaleRooms >
          0
        ) {
          console.log('[room-cleanup]', s)
        }
      })
      .catch(() => {})
  }

  // First sweep shortly after boot, then every 30s (§24: 30–60 seconds).
  const first = setTimeout(tick, 8_000)
  first.unref?.()
  const timer = setInterval(tick, Number.isFinite(intervalS) && intervalS >= 5 ? intervalS * 1000 : 30_000)
  timer.unref?.()
}
