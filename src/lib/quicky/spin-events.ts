// Quicky — Spin the Bottle ROOM EVENT BUS (PRD §60/§61)
//
// A tiny in-process pub/sub layer that lets the server state machine
// (spin-bottle.ts) announce "room state changed" moments. The SSE stream
// route (/api/quicky/games/spin-bottle/stream) subscribes per connected
// client and pushes a fresh snapshot on every event — this is the
// "controlled broadcast layer" the PRD allows instead of raw Supabase
// Postgres changes, and it keeps polling as a recovery path only (§2/§63).
//
// The bus is cached on globalThis so Next.js dev-mode hot reloads (which
// re-evaluate module graphs) never split publishers from subscribers.

type RoomListener = () => void

const g = globalThis as unknown as {
  __quickySpinBus?: Map<string, Set<RoomListener>>
}

const bus: Map<string, Set<RoomListener>> = (g.__quickySpinBus ??= new Map())

/** Announce that something about this room changed (round, players, lock). */
export function emitRoomUpdate(roomId: string) {
  const set = bus.get(roomId)
  if (!set) return
  for (const fn of set) {
    try {
      fn()
    } catch {
      // a dead SSE subscriber must never break the game loop
    }
  }
}

/** Subscribe to a room's updates. Returns an unsubscribe fn. */
export function subscribeRoom(roomId: string, fn: RoomListener): () => void {
  let set = bus.get(roomId)
  if (!set) {
    set = new Set()
    bus.set(roomId, set)
  }
  set.add(fn)
  return () => {
    set!.delete(fn)
    if (set!.size === 0) bus.delete(roomId)
  }
}
