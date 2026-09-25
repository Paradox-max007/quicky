-- ─────────────────────────────────────────────────────────────────────────────
-- migration-sync-crates-pass.sql — ONE-SHOT, IDEMPOTENT catch-up migration
--
-- WHY THIS EXISTS: the crates-pass schema changes (commit 3c27a31 — free +
-- crate prize tracks, per-level thresholds, per-placement crate points) can
-- be missing from a local machine whose Prisma client / database lagged
-- behind a git pull. Symptoms:
--   prisma:error  Unknown field `thresholdPoints` on CrateLevel
--   prisma:error  Unknown argument `cratePointsByPlace` on RealmDefinition
--   PATCH /api/quicky/admin/realm-config → 500 "not getting saved"
--   GET  /api/quicky/crates → silently empty level track
--
-- HOW TO APPLY (pick ONE, they are equivalent):
--   A) npx prisma db push                       ← recommended (also re-runs
--      `prisma generate` for you)
--   B) paste this whole file into the Supabase SQL editor and RUN
--
-- Safe to re-run: every statement is IF NOT EXISTS / guarded UPDATE, and the
-- guarded seeds only touch rows still holding their column defaults — admin
-- customizations made from the console are never overwritten.
-- Assumes the DB is at least at migration-pass-season-crates.sql (the Crate /
-- CrateLevel / CrateLevelGrant tables exist). If yours is older than that,
-- use option A — `prisma db push` computes the exact diff from any state.
-- ─────────────────────────────────────────────────────────────────────────────

-- CrateLevel: free track + per-level threshold --------------------------------
ALTER TABLE "CrateLevel" ADD COLUMN IF NOT EXISTS "freePrizeType"   TEXT    NOT NULL DEFAULT 'COINS';
ALTER TABLE "CrateLevel" ADD COLUMN IF NOT EXISTS "freeItemId"      TEXT;
ALTER TABLE "CrateLevel" ADD COLUMN IF NOT EXISTS "freePrizeName"   TEXT;
ALTER TABLE "CrateLevel" ADD COLUMN IF NOT EXISTS "freePrizeEmoji"  TEXT;
ALTER TABLE "CrateLevel" ADD COLUMN IF NOT EXISTS "freeQuantity"    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CrateLevel" ADD COLUMN IF NOT EXISTS "thresholdPoints" INTEGER NOT NULL DEFAULT 20;

-- Seed the free track + thresholds ONLY on rows that still hold the raw
-- column defaults (untouched): free prize = small coin drop (milestones
-- 25/50/100 get more), threshold = (level − 1) × 20 — level 1 = 0 so the
-- pass always starts unlocked at login.
UPDATE "CrateLevel" SET
  "freePrizeType"  = 'COINS',
  "freePrizeName"  = CASE WHEN "level" IN (25, 50, 100) THEN 'Milestone Free Coins' ELSE 'Free Coins' END,
  "freePrizeEmoji" = '🪙',
  "freeQuantity"   = CASE WHEN "level" IN (25, 50, 100) THEN 60 ELSE 10 END,
  "thresholdPoints" = ("level" - 1) * 20
WHERE "freePrizeName" IS NULL AND "freePrizeEmoji" IS NULL;

-- Heal rows seeded by the ORIGINAL crate-tracks migration (level × 20) to
-- the final rule ((level − 1) × 20; the app clamps at runtime anyway).
UPDATE "CrateLevel" SET "thresholdPoints" = ("level" - 1) * 20
WHERE "thresholdPoints" = "level" * 20;
UPDATE "CrateLevel" SET "thresholdPoints" = 0 WHERE "level" = 1;

-- CrateLevelGrant: per-track idempotency --------------------------------------
-- Existing rows are premium-track grants (they were gated on the purchase).
ALTER TABLE "CrateLevelGrant" ADD COLUMN IF NOT EXISTS "track" TEXT NOT NULL DEFAULT 'CRATE';
DROP INDEX IF EXISTS "CrateLevelGrant_userId_crateId_level_key";
CREATE UNIQUE INDEX IF NOT EXISTS "CrateLevelGrant_userId_crateId_level_track_key"
  ON "CrateLevelGrant"("userId", "crateId", "level", "track");

-- RealmDefinition: per-placement (1st-8th) crate points -----------------------
ALTER TABLE "RealmDefinition" ADD COLUMN IF NOT EXISTS "cratePointsByPlace" TEXT;
UPDATE "RealmDefinition"
  SET "cratePointsByPlace" = '{"1":100,"2":80,"3":60,"4":40,"5":25,"6":15,"7":10,"8":5}'
  WHERE "cratePointsByPlace" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- OPTIONAL data cleanup (cosmetic — legacy first/second/third blocks are
-- inert; realms get cleaned the first time an admin saves them):
--   UPDATE "RealmDefinition" SET "rewards" = jsonb_build_object(
--     'consolationCoins', COALESCE(rewards::jsonb->'consolationCoins', '{}'::jsonb)
--   )::text WHERE rewards LIKE '%first%' OR rewards LIKE '%second%';
--
-- NOTE — half-seeded crate heal: if the seed "Realm Crate" row exists with
-- ZERO level rows (a stale client rejected the level insert), nothing is
-- needed here: ensureCrateBootstrap() backfills the 100 levels automatically
-- on the next /api/quicky/crates load once the client + DB are in sync.
-- ─────────────────────────────────────────────────────────────────────────────
