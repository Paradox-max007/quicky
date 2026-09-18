import { PrismaClient } from '@prisma/client'

// ── Bounded connection pool (EMAXCONNSESSION fix) ────────────────────────────
// Supabase's Supavisor pooler (session mode) caps the WHOLE project at
// pool_size 15 CLIENTS. Prisma's default pool is num_cpus*2+1 (17+ on a
// typical dev machine), and hot paths like /api/quicky/dashboard fire 18
// parallel queries — together with per-request auth, discovery polling and
// the room-cleanup timer in instrumentation.ts that saturates the pooler and
// every query dies with:
//   FATAL (EMAXCONNSESSION) max clients reached in session mode
//
// Fix: cap THIS process' pool well below the server cap (default 5) and let
// Prisma QUEUE queries on those connections (pool_timeout) instead of opening
// new sessions. The params are injected into DATABASE_URL only when the URL
// does not ALREADY carry an explicit connection_limit, so any deployment can
// override the cap by adding ?connection_limit=N to its own DATABASE_URL.
function withBoundedPool(url: string | undefined): string | undefined {
  if (!url || !url.startsWith('postgres')) return url
  if (url.includes('connection_limit')) return url // explicit wins — never override the operator
  try {
    const u = new URL(url)
    u.searchParams.set('connection_limit', '5')
    u.searchParams.set('pool_timeout', '20') // queue up to 20s instead of failing fast
    u.searchParams.set('connect_timeout', '10')
    return u.toString()
  } catch {
    return url
  }
}

const databaseUrl = withBoundedPool(process.env.DATABASE_URL)

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
    ...(databaseUrl ? { datasourceUrl: databaseUrl } : {}),
  })

// Cache on globalThis in EVERY environment: survives Turbopack HMR
// re-evaluations and guarantees ONE pool per process (dev, prod, Capacitor
// server, everywhere).
globalForPrisma.prisma = db
