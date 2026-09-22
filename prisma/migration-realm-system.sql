-- Quicky — REALM PROGRESSION + GIFT MULTIPLIER EVENTS (realm PRD)
--
-- 8 new tables + the 15-realm seed. The realm system is GLOBAL Quicky
-- progression (shared by Spin the Bottle, Ludo and future games):
--   · RealmDefinition     — admin config (15 realms, thresholds, cycle
--                           duration, per-place rewards 5/3/1)
--   · GiftMultiplierEvent — temporary N× gift-point events (max 7 days,
--                           NO overlap — deterministic multiplier)
--   · RealmCycle          — 3-day competitive period per realm level
--                           (threshold + reward SNAPSHOTS per cycle)
--   · RealmCohort         — ≤7 players from the SAME realm level
--   · RealmCohortMember   — cycle points + final rank + promotion flag
--   · UserRealm           — persistent progression state per user
--   · RealmPointLedger    — immutable + IDEMPOTENT point audit trail
--                           (unique [sourceId, sourceType, userId])
--   · RealmRewardClaim    — settlement results (rank / promotion / rewards)
--
-- Settlement runs as an idempotent lazy backend job (status SETTLING acts
-- as the lock; settledAt gates re-entry). Promotion = rank ≤ 3 AND
-- cyclePoints ≥ snapshot threshold, in ONE server-side service.
--
-- Apply with either:
--   psql "$DATABASE_URL" -f prisma/migration-realm-system.sql
--   (or) bun run db:push   -- prisma/schema.prisma is already updated

CREATE TABLE IF NOT EXISTS "RealmDefinition" (
    "id"                TEXT NOT NULL,
    "level"             INTEGER NOT NULL,
    "name"              TEXT NOT NULL,
    "description"       TEXT,
    "promotionThreshold" INTEGER NOT NULL,
    "cycleDurationDays" INTEGER NOT NULL DEFAULT 3,
    "isActive"          BOOLEAN NOT NULL DEFAULT true,
    "rewards"           TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RealmDefinition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RealmDefinition_level_key" ON "RealmDefinition"("level");

CREATE TABLE IF NOT EXISTS "GiftMultiplierEvent" (
    "id"         TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "multiplier" INTEGER NOT NULL,
    "startsAt"   TIMESTAMP(3) NOT NULL,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "status"     TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdBy"  TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GiftMultiplierEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GiftMultiplierEvent_status_startsAt_expiresAt_idx"
    ON "GiftMultiplierEvent"("status", "startsAt", "expiresAt");

CREATE TABLE IF NOT EXISTS "RealmCycle" (
    "id"             TEXT NOT NULL,
    "realmLevel"     INTEGER NOT NULL,
    "startAt"        TIMESTAMP(3) NOT NULL,
    "endAt"          TIMESTAMP(3) NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'ACTIVE',
    "threshold"      INTEGER NOT NULL,
    "rewardSnapshot" TEXT,
    "durationDays"   INTEGER NOT NULL DEFAULT 3,
    "settledAt"      TIMESTAMP(3),
    "completedAt"    TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RealmCycle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RealmCycle_realmLevel_startAt_key" ON "RealmCycle"("realmLevel", "startAt");
CREATE INDEX IF NOT EXISTS "RealmCycle_realmLevel_status_idx" ON "RealmCycle"("realmLevel", "status");
CREATE INDEX IF NOT EXISTS "RealmCycle_status_endAt_idx" ON "RealmCycle"("status", "endAt");

CREATE TABLE IF NOT EXISTS "RealmCohort" (
    "id"              TEXT NOT NULL,
    "cycleId"         TEXT NOT NULL,
    "realmLevel"      INTEGER NOT NULL,
    "cohortStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isFinalized"     BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "RealmCohort_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RealmCohort_cycleId_idx" ON "RealmCohort"("cycleId");
CREATE INDEX IF NOT EXISTS "RealmCohort_realmLevel_isFinalized_idx" ON "RealmCohort"("realmLevel", "isFinalized");
-- Prisma relation from RealmCohort.cycleId → RealmCycle.id (CASCADE)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RealmCohort_cycleId_fkey') THEN
        ALTER TABLE "RealmCohort"
            ADD CONSTRAINT "RealmCohort_cycleId_fkey"
            FOREIGN KEY ("cycleId") REFERENCES "RealmCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "RealmCohortMember" (
    "id"                  TEXT NOT NULL,
    "cohortId"            TEXT NOT NULL,
    "userId"              TEXT NOT NULL,
    "cyclePoints"         INTEGER NOT NULL DEFAULT 0,
    "joinedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalRank"           INTEGER,
    "promoted"            BOOLEAN NOT NULL DEFAULT false,
    "thresholdReachedAt"  TIMESTAMP(3),
    CONSTRAINT "RealmCohortMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RealmCohortMember_cohortId_userId_key" ON "RealmCohortMember"("cohortId", "userId");
CREATE INDEX IF NOT EXISTS "RealmCohortMember_userId_idx" ON "RealmCohortMember"("userId");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RealmCohortMember_cohortId_fkey') THEN
        ALTER TABLE "RealmCohortMember"
            ADD CONSTRAINT "RealmCohortMember_cohortId_fkey"
            FOREIGN KEY ("cohortId") REFERENCES "RealmCohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "UserRealm" (
    "id"                     TEXT NOT NULL,
    "userId"                 TEXT NOT NULL,
    "realmLevel"             INTEGER NOT NULL DEFAULT 1,
    "currentCycleId"         TEXT,
    "cyclePoints"            INTEGER NOT NULL DEFAULT 0,
    "lifetimeRealmPoints"    INTEGER NOT NULL DEFAULT 0,
    "cohortId"               TEXT,
    "lastResultSeenCycleId"  TEXT,
    "joinedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserRealm_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserRealm_userId_key" ON "UserRealm"("userId");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserRealm_userId_fkey') THEN
        ALTER TABLE "UserRealm"
            ADD CONSTRAINT "UserRealm_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "RealmPointLedger" (
    "id"            TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "cycleId"       TEXT NOT NULL,
    "realmLevel"    INTEGER NOT NULL,
    "sourceType"    TEXT NOT NULL,
    "sourceId"      TEXT NOT NULL,
    "basePoints"    INTEGER NOT NULL,
    "multiplier"    INTEGER NOT NULL DEFAULT 1,
    "awardedPoints" INTEGER NOT NULL,
    "metadata"      TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RealmPointLedger_pkey" PRIMARY KEY ("id")
);
-- IDEMPOTENCY (PRD §20): one row per (gift event, role, user) — retries and
-- double-taps can never double-award points.
CREATE UNIQUE INDEX IF NOT EXISTS "RealmPointLedger_sourceId_sourceType_userId_key"
    ON "RealmPointLedger"("sourceId", "sourceType", "userId");
CREATE INDEX IF NOT EXISTS "RealmPointLedger_userId_createdAt_idx" ON "RealmPointLedger"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "RealmPointLedger_cycleId_userId_idx" ON "RealmPointLedger"("cycleId", "userId");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RealmPointLedger_userId_fkey') THEN
        ALTER TABLE "RealmPointLedger"
            ADD CONSTRAINT "RealmPointLedger_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "RealmRewardClaim" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "cycleId"   TEXT NOT NULL,
    "cohortId"  TEXT NOT NULL,
    "rank"      INTEGER NOT NULL,
    "promoted"  BOOLEAN NOT NULL DEFAULT false,
    "rewards"   TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    CONSTRAINT "RealmRewardClaim_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RealmRewardClaim_userId_cycleId_key" ON "RealmRewardClaim"("userId", "cycleId");
CREATE INDEX IF NOT EXISTS "RealmRewardClaim_cycleId_idx" ON "RealmRewardClaim"("cycleId");
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RealmRewardClaim_userId_fkey') THEN
        ALTER TABLE "RealmRewardClaim"
            ADD CONSTRAINT "RealmRewardClaim_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ─── SEED: the 15 realms (PRD §3 exact hierarchy) ───────────────────────────
-- Thresholds are EXAMPLE starting values (PRD §25) — the admin panel owns
-- them from here on. The Apex (15) has no promotion threshold (level cap).
INSERT INTO "RealmDefinition" ("id", "level", "name", "description", "promotionThreshold", "cycleDurationDays")
VALUES
    (gen_random_uuid()::text,  1, 'The Abyss',           'The absolute bottom; unranked, forgotten, or outcast layer.', 100, 3),
    (gen_random_uuid()::text,  2, 'The Dregs',           'Lowest recognized status; manual labor, survival, and basic subsistence.', 250, 3),
    (gen_random_uuid()::text,  3, 'The Fringe',          'The outer border; individuals on the edge of societal inclusion.', 500, 3),
    (gen_random_uuid()::text,  4, 'The Threshold',       'Entry-level status; initiates, novices, and new entrants seeking footing.', 750, 3),
    (gen_random_uuid()::text,  5, 'The Bedrock',         'The working foundation; steady, reliable, but low-status contributors.', 1000, 3),
    (gen_random_uuid()::text,  6, 'The Commonalty',      'Standard civilian status; average citizens and general working class.', 1500, 3),
    (gen_random_uuid()::text,  7, 'The Guild Rank',      'Skilled practitioners, tradespeople, and established specialists.', 2000, 3),
    (gen_random_uuid()::text,  8, 'The Meridian',        'The exact middle tier; the balancing point between lower and upper society.', 2500, 3),
    (gen_random_uuid()::text,  9, 'The Ascendant',       'Rising talent and prosperous individuals on the track to high status.', 3000, 3),
    (gen_random_uuid()::text, 10, 'The Dominion',        'Established power, influential factions, and upper-middle elites.', 4000, 3),
    (gen_random_uuid()::text, 11, 'The Echelon',         'Proven leaders, high ranking officials, and major nobility or executives.', 5000, 3),
    (gen_random_uuid()::text, 12, 'The Eminent',         'Renowned figureheads whose influence dictates regional policy or culture.', 6000, 3),
    (gen_random_uuid()::text, 13, 'The Sovereign Realm', 'Ruling bodies, monarchs, or top-tier executives with supreme command.', 7500, 3),
    (gen_random_uuid()::text, 14, 'The Prime',           'Legendary figures who define the era; almost completely untouchable status.', 9000, 3),
    (gen_random_uuid()::text, 15, 'The Apex',            'The pinnacle; absolute authority, supreme mastery, or God-tier status.', 0, 3)
ON CONFLICT ("level") DO NOTHING;
