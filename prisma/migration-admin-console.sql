-- Quicky — ADMIN CONSOLE + DYNAMIC GAME CONTENT (admin-console PRD)
--
-- 7 new tables + 3 column changes. Turns the admin console into a
-- database-driven content/reward/progression system:
--   · RealmSeason      — configurable seasons over the 15-realm ladder;
--                        per-season realm NAME overrides; players roll into
--                        season N+1 after finishing every realm of season N
--   · Reward           — reusable reward catalog (COINS / STICKER_SET /
--                        GIFT / HAT / PROFILE_FRAME / NAME_DECORATOR /
--                        CHAT_BUBBLE), 3 cosmetic levels in metadata JSON
--   · RealmRewardRule  — catalog rewards assigned to realm positions
--                        (1st ≤ 5, 2nd ≤ 3, 3rd ≤ 1) + reward level
--   · UserRewardGrant  — PENDING→CLAIMED reward grants (popup collection,
--                        idempotent unique [userId, cycleId, rewardId, level])
--   · UserCosmetic     — owned cosmetics inventory + equip (one per type)
--   · AdminTestAccount — designated test account (server-controlled,
--                        environment-restricted "Open as Test User")
--   · AdminSetting     — console key/value settings (web app URL, …)
--
-- Column changes:
--   · "UserRealm"."seasonNumber"      (default 1)
--   · "GameStickerBundle"."realmLevel" + "winnerPositions"  (realm-linked
--     qualification — 1st/2nd place receive the sticker set)
--   · "GameStickerBundle"."minimumLeaguePoints" REMOVED (admin-console PRD
--     §13.2 — obsolete qualification logic dropped from schema AND backend)
--
-- Supabase Storage:
--   · bucket "quicky-assets" (public read) — gifts/ stickers/ cosmetics/
--     animations/ folders. Server uploads with SUPABASE_SERVICE_ROLE_KEY;
--     when the key is absent the app falls back to public/uploads/assets.
--
-- Apply with either:
--   psql "$DATABASE_URL" -f prisma/migration-admin-console.sql
--   (or) bun run db:push   -- prisma/schema.prisma is already updated
--   Supabase Storage section: run in the Supabase SQL editor.

-- ─── Seasons ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RealmSeason" (
    "id"                 TEXT NOT NULL,
    "seasonNumber"       INTEGER NOT NULL,
    "name"               TEXT NOT NULL,
    "description"        TEXT,
    "realmNameOverrides" TEXT,
    "isActive"           BOOLEAN NOT NULL DEFAULT true,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RealmSeason_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RealmSeason_seasonNumber_key" ON "RealmSeason"("seasonNumber");
CREATE INDEX IF NOT EXISTS "RealmSeason_isActive_seasonNumber_idx" ON "RealmSeason"("isActive", "seasonNumber");

-- Default Season 1 (idempotent).
INSERT INTO "RealmSeason" ("id", "seasonNumber", "name", "description", "isActive")
SELECT 'season_0000000000000001', 1, 'Season of Dawn', 'The first Quicky season — climb all 15 realms to complete it.', true
WHERE NOT EXISTS (SELECT 1 FROM "RealmSeason" WHERE "seasonNumber" = 1);

-- ─── Reward catalog ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Reward" (
    "id"          TEXT NOT NULL,
    "rewardType"  TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "rarity"      TEXT NOT NULL DEFAULT 'COMMON',
    "status"      TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata"    TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Reward_rewardType_check" CHECK ("rewardType" IN
        ('COINS', 'STICKER_SET', 'GIFT', 'HAT', 'PROFILE_FRAME', 'NAME_DECORATOR', 'CHAT_BUBBLE'))
);
CREATE INDEX IF NOT EXISTS "Reward_rewardType_status_idx" ON "Reward"("rewardType", "status");

CREATE TABLE IF NOT EXISTS "RealmRewardRule" (
    "id"         TEXT NOT NULL,
    "realmLevel" INTEGER NOT NULL,
    "position"   INTEGER NOT NULL,
    "rewardId"   TEXT NOT NULL,
    "level"      INTEGER NOT NULL DEFAULT 1,
    "quantity"   INTEGER NOT NULL DEFAULT 1,
    "isActive"   BOOLEAN NOT NULL DEFAULT true,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RealmRewardRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RealmRewardRule_rewardId_fkey" FOREIGN KEY ("rewardId")
        REFERENCES "Reward"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "RealmRewardRule_realmLevel_position_rewardId_key"
    ON "RealmRewardRule"("realmLevel", "position", "rewardId");
CREATE INDEX IF NOT EXISTS "RealmRewardRule_realmLevel_isActive_idx" ON "RealmRewardRule"("realmLevel", "isActive");

CREATE TABLE IF NOT EXISTS "UserRewardGrant" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "cycleId"        TEXT,
    "realmLevel"     INTEGER NOT NULL DEFAULT 1,
    "rewardId"       TEXT NOT NULL,
    "rewardSnapshot" TEXT NOT NULL,
    "quantity"       INTEGER NOT NULL DEFAULT 1,
    "level"          INTEGER NOT NULL DEFAULT 1,
    "status"         TEXT NOT NULL DEFAULT 'PENDING',
    "grantedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt"      TIMESTAMP(3),
    "expiresAt"      TIMESTAMP(3),
    CONSTRAINT "UserRewardGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserRewardGrant_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE,
    CONSTRAINT "UserRewardGrant_rewardId_fkey" FOREIGN KEY ("rewardId")
        REFERENCES "Reward"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserRewardGrant_userId_cycleId_rewardId_level_key"
    ON "UserRewardGrant"("userId", "cycleId", "rewardId", "level");
CREATE INDEX IF NOT EXISTS "UserRewardGrant_userId_status_idx" ON "UserRewardGrant"("userId", "status");

CREATE TABLE IF NOT EXISTS "UserCosmetic" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "rewardId"  TEXT NOT NULL,
    "level"     INTEGER NOT NULL DEFAULT 1,
    "source"    TEXT NOT NULL DEFAULT 'REALM_REWARD',
    "equipped"  BOOLEAN NOT NULL DEFAULT false,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserCosmetic_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserCosmetic_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE,
    CONSTRAINT "UserCosmetic_rewardId_fkey" FOREIGN KEY ("rewardId")
        REFERENCES "Reward"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserCosmetic_userId_rewardId_level_key"
    ON "UserCosmetic"("userId", "rewardId", "level");
CREATE INDEX IF NOT EXISTS "UserCosmetic_userId_equipped_idx" ON "UserCosmetic"("userId", "equipped");

-- ─── Test account + console settings ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AdminTestAccount" (
    "id"                 TEXT NOT NULL,
    "userId"             TEXT NOT NULL,
    "displayName"        TEXT NOT NULL DEFAULT 'Quicky Tester',
    "enabled"            BOOLEAN NOT NULL DEFAULT false,
    "allowedEnvironments" TEXT NOT NULL DEFAULT 'development',
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminTestAccount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdminTestAccount_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdminTestAccount_userId_key" ON "AdminTestAccount"("userId");

CREATE TABLE IF NOT EXISTS "AdminSetting" (
    "key"       TEXT NOT NULL,
    "value"     TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminSetting_pkey" PRIMARY KEY ("key")
);

-- ─── UserRealm: season number ──────────────────────────────────────────────
ALTER TABLE "UserRealm" ADD COLUMN IF NOT EXISTS "seasonNumber" INTEGER NOT NULL DEFAULT 1;

-- ─── GameStickerBundle: realm-linked qualification; drop minimumLeaguePoints
-- (admin-console PRD §13.2 — remove the obsolete min-points rule everywhere).
ALTER TABLE "GameStickerBundle" ADD COLUMN IF NOT EXISTS "realmLevel" INTEGER;
ALTER TABLE "GameStickerBundle" ADD COLUMN IF NOT EXISTS "winnerPositions" TEXT;
ALTER TABLE "GameStickerBundle" DROP COLUMN IF EXISTS "minimumLeaguePoints";
CREATE INDEX IF NOT EXISTS "GameStickerBundle_unlockType_realmLevel_idx"
    ON "GameStickerBundle"("unlockType", "realmLevel");

-- ═══ Supabase Storage — run in the Supabase SQL editor (harmless if skipped:
-- the app falls back to local uploads when the bucket/service key is absent,
-- and creates the bucket on first upload when possible). ═══════════════════
--
-- insert into storage.buckets (id, name, public)
-- values ('quicky-assets', 'quicky-assets', true)
-- on conflict (id) do nothing;
--
-- create policy "quicky-assets public read" on storage.objects
--   for select using (bucket_id = 'quicky-assets');
