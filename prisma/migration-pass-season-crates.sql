-- ─────────────────────────────────────────────────────────────────────────────
-- crate-pass PRD — Monthly Season + Crates (realm pass)
-- Apply with:  npx prisma db push
-- (This file documents the change for review/history — the repo tracks the
--  schema through `prisma db push`, not numbered migrations.)
--
-- What's new:
--   · Season / SeasonGift / SeasonEvent / UserSeason — the MONTHLY season
--     (the ❤ room chip shows the viewer's points for the active season).
--     Distinct from RealmSeason (the realm-LADDER season).
--   · Crate / CrateLevel / UserCrate / CrateLevelGrant — the purchasable
--     100-level "realm pass" opened from the 👑 room chip.
--   · RealmDefinition.cratePoints — crate points granted when a realm is
--     WON (promotion at settlement); defaults to the level number
--     (successive incrementation), admin-editable per realm.
-- ─────────────────────────────────────────────────────────────────────────────

-- Realm wins feed the crate pass: seed the existing 15 tiers with the
-- successive incrementation default (level N grants N crate points).
ALTER TABLE "RealmDefinition" ADD COLUMN "cratePoints" INTEGER NOT NULL DEFAULT 1;
UPDATE "RealmDefinition" SET "cratePoints" = "level";

-- Monthly season ------------------------------------------------------------
CREATE TABLE "Season" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "imageUrl"  TEXT,
    "startsAt"  TIMESTAMP(3) NOT NULL,
    "endsAt"    TIMESTAMP(3) NOT NULL,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Season_isActive_startsAt_endsAt_idx" ON "Season"("isActive", "startsAt", "endsAt");

CREATE TABLE "SeasonGift" (
    "id"        TEXT NOT NULL,
    "seasonId"  TEXT NOT NULL,
    "itemId"    TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SeasonGift_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SeasonGift_seasonId_itemId_key" ON "SeasonGift"("seasonId", "itemId");
ALTER TABLE "SeasonGift" ADD CONSTRAINT "SeasonGift_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SeasonEvent" (
    "id"          TEXT NOT NULL,
    "seasonId"    TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "emoji"       TEXT NOT NULL DEFAULT '✨',
    "description" TEXT,
    "multiplier"  INTEGER NOT NULL DEFAULT 1,
    "startsAt"    TIMESTAMP(3) NOT NULL,
    "endsAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SeasonEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SeasonEvent_seasonId_startsAt_idx" ON "SeasonEvent"("seasonId", "startsAt");
ALTER TABLE "SeasonEvent" ADD CONSTRAINT "SeasonEvent_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UserSeason" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "seasonId"  TEXT NOT NULL,
    "points"    INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserSeason_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserSeason_userId_seasonId_key" ON "UserSeason"("userId", "seasonId");
CREATE INDEX "UserSeason_seasonId_points_idx" ON "UserSeason"("seasonId", "points");
ALTER TABLE "UserSeason" ADD CONSTRAINT "UserSeason_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSeason" ADD CONSTRAINT "UserSeason_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Crates (realm pass) ---------------------------------------------------------
CREATE TABLE "Crate" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "imageUrl"    TEXT,
    "priceCoins"  INTEGER NOT NULL DEFAULT 500,
    "levelCount"  INTEGER NOT NULL DEFAULT 100,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "sortOrder"   INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Crate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Crate_isActive_sortOrder_idx" ON "Crate"("isActive", "sortOrder");

CREATE TABLE "CrateLevel" (
    "id"         TEXT NOT NULL,
    "crateId"    TEXT NOT NULL,
    "level"      INTEGER NOT NULL,
    "prizeType"  TEXT NOT NULL DEFAULT 'GIFT',
    "itemId"     TEXT,
    "prizeName"  TEXT,
    "prizeEmoji" TEXT,
    "quantity"   INTEGER NOT NULL DEFAULT 1,
    "priceCoins" INTEGER NOT NULL DEFAULT 100,
    CONSTRAINT "CrateLevel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrateLevel_crateId_level_key" ON "CrateLevel"("crateId", "level");
ALTER TABLE "CrateLevel" ADD CONSTRAINT "CrateLevel_crateId_fkey" FOREIGN KEY ("crateId") REFERENCES "Crate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UserCrate" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "crateId"      TEXT NOT NULL,
    "unlockedAt"   TIMESTAMP(3),
    "cratePoints"  INTEGER NOT NULL DEFAULT 0,
    "boughtLevels" INTEGER NOT NULL DEFAULT 0,
    "currentLevel" INTEGER NOT NULL DEFAULT 0,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserCrate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserCrate_userId_crateId_key" ON "UserCrate"("userId", "crateId");
ALTER TABLE "UserCrate" ADD CONSTRAINT "UserCrate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserCrate" ADD CONSTRAINT "UserCrate_crateId_fkey" FOREIGN KEY ("crateId") REFERENCES "Crate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CrateLevelGrant" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "crateId"   TEXT NOT NULL,
    "level"     INTEGER NOT NULL,
    "source"    TEXT NOT NULL DEFAULT 'WON',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrateLevelGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrateLevelGrant_userId_crateId_level_key" ON "CrateLevelGrant"("userId", "crateId", "level");
CREATE INDEX "CrateLevelGrant_userId_createdAt_idx" ON "CrateLevelGrant"("userId", "createdAt");
ALTER TABLE "CrateLevelGrant" ADD CONSTRAINT "CrateLevelGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
