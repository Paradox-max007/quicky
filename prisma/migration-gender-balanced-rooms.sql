-- Quicky — PRD: Games Platform (gender-balanced rooms + sticker unlock types)
-- Run against the Supabase/Postgres database before deploying the app update.
--
-- 1) SpinRoom gains gender capacities (6 male + 6 female seats; the seat's
--    parity IS its gender slot: even seatIndex = male, odd = female).
-- 2) GameStickerBundle gains an explicit unlockType (coins | league | season |
--    event | subscription | free) + optional eventId, per PRD §32.
-- Idempotent: safe to run more than once.

-- ── 1. Gender-balanced rooms ────────────────────────────────────────────────
ALTER TABLE "SpinRoom" ADD COLUMN IF NOT EXISTS "maleCapacity"   INTEGER NOT NULL DEFAULT 6;
ALTER TABLE "SpinRoom" ADD COLUMN IF NOT EXISTS "femaleCapacity" INTEGER NOT NULL DEFAULT 6;

-- ── 2. Sticker unlock types ─────────────────────────────────────────────────
ALTER TABLE "GameStickerBundle" ADD COLUMN IF NOT EXISTS "unlockType" TEXT NOT NULL DEFAULT 'coins';
ALTER TABLE "GameStickerBundle" ADD COLUMN IF NOT EXISTS "eventId"    TEXT;

-- Platform events gate event-unlock sticker sets (PRD §32).
CREATE TABLE IF NOT EXISTS "GameEvent" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "startsAt"    TIMESTAMP(3),
  "endsAt"      TIMESTAMP(3),
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GameEvent_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GameStickerBundle_eventId_fkey'
  ) THEN
    ALTER TABLE "GameStickerBundle"
      ADD CONSTRAINT "GameStickerBundle_eventId_fkey"
      FOREIGN KEY ("eventId") REFERENCES "GameEvent"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: derive unlockType from the legacy flag columns so nothing changes
-- behaviour after the column appears.
UPDATE "GameStickerBundle"
SET "unlockType" = CASE
  WHEN "rewardEnabled" AND "minimumLeaguePoints" > 0 THEN 'league'
  WHEN "purchaseEnabled" AND "priceCoins" > 0        THEN 'coins'
  ELSE 'free'
END
WHERE "unlockType" = 'coins'
  AND ("rewardEnabled" = TRUE OR "purchaseEnabled" = TRUE OR "priceCoins" > 0);

-- ── 3. Gift send rules (PRD §62) ────────────────────────────────────────────
ALTER TABLE "GameItem" ADD COLUMN IF NOT EXISTS "maxQuantity" INTEGER;

-- ── 4. Seat race protection (PRD §10) ───────────────────────────────────────
-- One ACTIVE occupant per seat, enforced by the DATABASE. The join algorithm
-- also re-validates gender capacity inside its transaction; this index makes
-- a double-claim of the same seat physically impossible under concurrency.
CREATE UNIQUE INDEX IF NOT EXISTS "SpinRoomPlayer_active_seat_unique"
  ON "SpinRoomPlayer"("roomId", "seatIndex")
  WHERE "isActive" = TRUE AND "leftAt" IS NULL;

-- Event unlock needs the event to exist and be joinable later; no FK on
-- purpose (QuickyEvent rows are product data, bundles outlive events).
CREATE INDEX IF NOT EXISTS "GameStickerBundle_eventId_idx" ON "GameStickerBundle"("eventId");
