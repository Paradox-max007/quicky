-- Quicky — Rewarded Ads & Real Payments (Monetization PRD)
-- Migration for: WalletTransaction, RewardAdSession, PaymentEvent models +
-- GameCoinPackage catalog extension (kind, realmPoints, plan, provider ids).
--
-- Apply with EITHER:
--   bunx prisma db push            (schema-authoritative, dev/staging)
--   psql "$DIRECT_URL" -f prisma/migration-rewards-payments.sql   (exact SQL)
--
-- The CHECK constraints below are the DB-level guarantees from PRD §6.3
-- (prisma db push will NOT create them — run this file if you want them).

-- ─── 1. New tables ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "WalletTransaction" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "currencyType"   TEXT NOT NULL,
    "amount"         INTEGER NOT NULL,
    "transactionType" TEXT NOT NULL,
    "source"         TEXT NOT NULL,
    "sourceId"       TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "balanceAfter"   INTEGER,
    "metadata"       TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WalletTransaction_idempotencyKey_key"
    ON "WalletTransaction"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "WalletTransaction_userId_createdAt_idx"
    ON "WalletTransaction"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "WalletTransaction_source_sourceId_idx"
    ON "WalletTransaction"("source", "sourceId");

ALTER TABLE "WalletTransaction"
    ADD CONSTRAINT "WalletTransaction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Wallet ledger rows only cover real monetization mutations; amounts are signed.
ALTER TABLE "WalletTransaction"
    ADD CONSTRAINT "WalletTransaction_currencyType_check"
    CHECK ("currencyType" IN ('COINS', 'REALM_POINTS'));


CREATE TABLE IF NOT EXISTS "RewardAdSession" (
    "id"                    TEXT NOT NULL,
    "userId"                TEXT NOT NULL,
    "rewardType"            TEXT NOT NULL,
    "status"                TEXT NOT NULL DEFAULT 'PENDING',
    "provider"             TEXT NOT NULL DEFAULT 'admob',
    "providerTransactionId" TEXT,
    "rewardAmount"          INTEGER,
    "metadata"             TEXT,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"            TIMESTAMP(3) NOT NULL,
    "completedAt"          TIMESTAMP(3),

    CONSTRAINT "RewardAdSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RewardAdSession_provider_providerTransactionId_key"
    ON "RewardAdSession"("provider", "providerTransactionId");
CREATE INDEX IF NOT EXISTS "RewardAdSession_userId_createdAt_idx"
    ON "RewardAdSession"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "RewardAdSession_status_createdAt_idx"
    ON "RewardAdSession"("status", "createdAt");

ALTER TABLE "RewardAdSession"
    ADD CONSTRAINT "RewardAdSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PRD §6.3 — completed ad rewards are always within the approved 10–100 range.
ALTER TABLE "RewardAdSession"
    ADD CONSTRAINT "RewardAdSession_rewardAmount_check"
    CHECK ("rewardAmount" IS NULL OR ("rewardAmount" >= 10 AND "rewardAmount" <= 100));
ALTER TABLE "RewardAdSession"
    ADD CONSTRAINT "RewardAdSession_rewardType_check"
    CHECK ("rewardType" IN ('COINS', 'REALM_POINTS'));
ALTER TABLE "RewardAdSession"
    ADD CONSTRAINT "RewardAdSession_status_check"
    CHECK ("status" IN ('PENDING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'));


CREATE TABLE IF NOT EXISTS "PaymentEvent" (
    "id"              TEXT NOT NULL,
    "provider"        TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType"       TEXT NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'PROCESSED',
    "payload"         TEXT,
    "processedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentEvent_provider_providerEventId_key"
    ON "PaymentEvent"("provider", "providerEventId");
CREATE INDEX IF NOT EXISTS "PaymentEvent_provider_processedAt_idx"
    ON "PaymentEvent"("provider", "processedAt");

-- ─── 2. GameCoinPackage catalog extension (PRD §5.1) ────────────────────────

ALTER TABLE "GameCoinPackage"
    ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'COIN_PACK',
    ADD COLUMN IF NOT EXISTS "realmPoints" INTEGER,
    ADD COLUMN IF NOT EXISTS "plan" TEXT,
    ADD COLUMN IF NOT EXISTS "stripePriceId" TEXT,
    ADD COLUMN IF NOT EXISTS "googlePlayProductId" TEXT;

ALTER TABLE "GameCoinPackage"
    ADD CONSTRAINT "GameCoinPackage_kind_check"
    CHECK ("kind" IN ('COIN_PACK', 'REALM_POINTS_PACK', 'SUBSCRIPTION'));

-- ─── 3. Balance non-negativity (PRD §6.3 — coins_balance >= 0) ─────────────

ALTER TABLE "User"
    ADD CONSTRAINT "User_coinBalance_nonnegative_check"
    CHECK ("coinBalance" >= 0);
