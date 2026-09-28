-- ─────────────────────────────────────────────────────────────────────────────
-- migration-sync-admin-prd.sql — ONE-SHOT, IDEMPOTENT catch-up migration
--
-- WHY THIS EXISTS: the admin-console PRD changes (How It Works drafts/
-- publishing, gift availability windows) can be missing from a local machine
-- whose Prisma client / database lagged behind a git pull. Symptoms:
--   prisma:error  Unknown field `status` on GameRule        (draft/publish)
--   prisma:error  Unknown field `availableFrom` on GameItem (gift windows)
--
-- HOW TO APPLY (pick ONE, they are equivalent):
--   A) npx prisma db push                       ← recommended (also re-runs
--      `prisma generate` for you)
--   B) paste this whole file into the Supabase SQL editor and RUN
--
-- Safe to re-run: every statement is IF NOT EXISTS / guarded. No data is
-- rewritten — existing rules stay PUBLISHED, existing gifts keep their
-- always-available (NULL) windows.
-- ─────────────────────────────────────────────────────────────────────────────

-- GameRule: draft / publish states (admin-console PRD §5.1) ------------------
-- Existing rows default to PUBLISHED — the game screen keeps serving them;
-- only admins who explicitly flip a step to DRAFT hide it from the app.
ALTER TABLE "GameRule" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PUBLISHED';

-- GameItem: optional gift availability window (admin-console PRD §6.1) -------
-- NULL = always available (the pre-PRD behavior for every existing gift).
ALTER TABLE "GameItem" ADD COLUMN IF NOT EXISTS "availableFrom"  TIMESTAMP;
ALTER TABLE "GameItem" ADD COLUMN IF NOT EXISTS "availableUntil" TIMESTAMP;

-- Normalize any invalid draft migration leftovers (status must be a known
-- state; anything else snaps back to PUBLISHED so the game screen never
-- serves an unknown state).
UPDATE "GameRule" SET "status" = 'PUBLISHED'
WHERE "status" IS NULL OR "status" NOT IN ('DRAFT', 'PUBLISHED');
