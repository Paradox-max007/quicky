// Quicky — PRISMA SCHEMA-DRIFT GUARD
//
// The app evolves the Prisma schema often (seasons, crates, unified
// rewards…). Two things must follow on every machine that runs the code:
//   1. the GENERATED CLIENT  → `npx prisma generate` (now automatic: the
//      `dev`/`build` scripts and `postinstall` all run it first)
//   2. the DATABASE itself   → `npx prisma db push`
// If either lags behind, Prisma fails at runtime with confusing errors
// ("Unknown argument `cratePointsByPlace`", P2021/P2022…) — e.g. saving a
// realm config silently 500s. These helpers surface the REAL cause with the
// exact remedy instead of a cryptic stack trace.
import { Prisma } from '@prisma/client'

/**
 * True when a Prisma error means the generated client / database is older
 * than the code's schema (stale `prisma generate` or a missed `db push`) —
 * NOT a bad request and NOT a real data bug.
 */
export function isPrismaSchemaDrift(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientValidationError) return true
  const code = (err as { code?: string } | null | undefined)?.code
  // P2021: table does not exist · P2022: column does not exist
  return code === 'P2021' || code === 'P2022'
}

/** Human-readable remedy returned to the admin UI on drift errors. */
export const SCHEMA_SYNC_HINT =
  'The app code is ahead of the Prisma client/database on this machine. Run "npx prisma generate" then "npx prisma db push" (or apply prisma/migration-sync-crates-pass.sql in the Supabase SQL editor) and restart the dev server.'
