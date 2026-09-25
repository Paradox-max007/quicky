-- ─────────────────────────────────────────────────────────────────────────────
-- crate-tracks PRD — Battle-pass crate room (free + crate prize tracks,
-- per-level thresholds, per-placement realm crate points)
-- Apply with:  npx prisma db push
-- (This file documents the change for review/history — the repo tracks the
--  schema through `prisma db push`, not numbered migrations.)
--
-- What's new (on top of migration-pass-season-crates.sql):
--   · CrateLevel — every level now carries TWO prizes:
--       - the FREE track prize (freePrizeType/freeItemId/freePrizeName/
--         freePrizeEmoji/freeQuantity) — collectible by realm wins alone,
--         no purchase needed
--       - the CRATE track prize (the existing prizeType/itemId/… fields) —
--         only once the crate pack is bought
--     plus thresholdPoints: the CUMULATIVE crate points required to reach
--     the level (admin-set per level; the pass progress bar fills between
--     thresholds — level N defaults to N×20).
--   · CrateLevelGrant.track — grants are idempotent PER TRACK
--     (userId+crateId+level+track): FREE | CRATE.
--   · RealmDefinition.cratePointsByPlace — JSON { "1": 100, … "8": 5 }:
--     when a realm cycle settles, EVERY player ranked 1st-8th earns their
--     place's crate points from that realm's table (admin-editable per
--     realm). The old flat cratePoints column stays as a legacy fallback.
-- Existing crates: levels gain the default free coin prize + N×20
-- thresholds; previously granted prizes become track="CRATE" rows.
-- ─────────────────────────────────────────────────────────────────────────────

-- CrateLevel: free track + per-level threshold --------------------------------
ALTER TABLE "CrateLevel" ADD COLUMN "freePrizeType"  TEXT    NOT NULL DEFAULT 'COINS';
ALTER TABLE "CrateLevel" ADD COLUMN "freeItemId"     TEXT;
ALTER TABLE "CrateLevel" ADD COLUMN "freePrizeName"  TEXT;
ALTER TABLE "CrateLevel" ADD COLUMN "freePrizeEmoji" TEXT;
ALTER TABLE "CrateLevel" ADD COLUMN "freeQuantity"   INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CrateLevel" ADD COLUMN "thresholdPoints" INTEGER NOT NULL DEFAULT 20;

-- Seed the free track + thresholds on existing level rows:
-- free prize = small coin drop (milestones 25/50/100 get more),
-- threshold  = level × 20.
UPDATE "CrateLevel" SET
  "freePrizeType"  = 'COINS',
  "freePrizeName"  = CASE WHEN "level" IN (25, 50, 100) THEN 'Milestone Free Coins' ELSE 'Free Coins' END,
  "freePrizeEmoji" = '🪙',
  "freeQuantity"   = CASE WHEN "level" IN (25, 50, 100) THEN 60 ELSE 10 END,
  "thresholdPoints" = "level" * 20;

-- CrateLevelGrant: per-track idempotency --------------------------------------
-- Existing rows are premium-track grants (they were gated on the purchase).
ALTER TABLE "CrateLevelGrant" ADD COLUMN "track" TEXT NOT NULL DEFAULT 'CRATE';
DROP INDEX IF EXISTS "CrateLevelGrant_userId_crateId_level_key";
CREATE UNIQUE INDEX "CrateLevelGrant_userId_crateId_level_track_key"
  ON "CrateLevelGrant"("userId", "crateId", "level", "track");

-- RealmDefinition: per-placement crate points ---------------------------------
ALTER TABLE "RealmDefinition" ADD COLUMN "cratePointsByPlace" TEXT;
-- Seed the default placement table (1st=100 … 8th=5) everywhere — admins
-- own the values afterwards from the console.
UPDATE "RealmDefinition"
  SET "cratePointsByPlace" = '{"1":100,"2":80,"3":60,"4":40,"5":25,"6":15,"7":10,"8":5}';
