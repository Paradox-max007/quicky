// Quicky — lightweight in-memory rate limiter (bug-fix PRD §120).
//
// Server-side throttling for chat writes: messages, reactions and media
// sends must not be spammable. Fixed-window counters per (bucket, user).
// Single-process (this deployment runs one Next.js server) — the guarantee
// is best-effort flood protection, not billing-grade accounting.
const buckets = new Map<string, { windowStart: number; count: number }>()

// Periodic sweep so long-running processes don't accumulate dead buckets.
const SWEEP_EVERY_MS = 5 * 60_000
let lastSweep = Date.now()

function sweep(now: number) {
  if (now - lastSweep < SWEEP_EVERY_MS) return
  lastSweep = now
  for (const [key, b] of buckets) {
    if (now - b.windowStart > 60_000) buckets.delete(key)
  }
}

/**
 * Consume one token from (bucket, userId). Returns false when over the
 * limit of `max` events per `windowMs`.
 */
export function rateLimit(bucket: string, userId: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now()
  sweep(now)
  const key = `${bucket}:${userId}`
  const b = buckets.get(key)
  if (!b || now - b.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 })
    return true
  }
  if (b.count >= max) return false
  b.count += 1
  return true
}
