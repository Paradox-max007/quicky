-- ─────────────────────────────────────────────────────────────────────────────
-- game-store update — the Games section's OWN economy (Game Economy PRD).
-- SCHEMA CHANGE — run `npx prisma db push` (preferred) OR this idempotent
-- SQL by hand. Everything below is CREATE TABLE IF NOT EXISTS / ADD COLUMN
-- IF NOT EXISTS-style guarded, so re-running is always safe.
--
-- What changed:
--   · FOUR separated value types: REAL MONEY → Coins | Crates; Coins →
--     Gifts/Cosmetics; Realm Points earned via gameplay. Crates are
--     REAL-MONEY ONLY (never coins). The dating-app Premium subscription is
--     untouched and separate — the store is branded "Game Store" (§72).
--   · GameCoinPackage — admin-configured coin packs (coins, bonus, price,
--     badge, featured, premium-only, order, active). Self-healing seed on
--     first store request.
--   · GamePurchase — the ledger for EVERY real-money game purchase
--     (PENDING → PROCESSING → COMPLETED | FAILED | REFUNDED | CANCELLED).
--     Crediting is always server-side (the client never reports success).
--   · CrateProduct + CratePurchase — real-money crates with DISCLOSED
--     contents (realm points / coins / gift / cosmetic). Purchase (OWNED)
--     is separate from OPEN (rewards granted, exactly once); the sync
--     endpoint recovers paid-but-unopened crates.
--   · RealmBoostConfig — the FINAL-HOURS boost: default row (realmLevel
--     NULL = all realms) + per-realm overrides. Active on the SERVER clock
--     at cycleEnd − hoursBeforeEnd; never randomized, never client-set.
--   · GameMonetizationEvent — funnel tracking (store_opened,
--     checkout_started, purchase_completed, crate_opened, …).
--   · Reward.priceCoins — cosmetics become coin-purchasable in the store
--     (null = realm-exclusive / not for sale). Seeded by rarity:
--     COMMON 500 / RARE 1000 / EPIC 2000 / LEGENDARY 4000.
--
-- Payment architecture: PaymentService routes per platform
-- (WebPaymentAdapter / AndroidPaymentAdapter / IOSPaymentAdapter, PRD §12).
-- This build ships the SANDBOX adapter behind every route (labelled
-- "mock" in ledgers + UI); Stripe / Google Play billing / StoreKit slot
-- into the same seam without UI changes.
-- ─────────────────────────────────────────────────────────────────────────────

-- Reward gets a coin price (cosmetic store, PRD §34) ────────────────────────
ALTER TABLE "Reward" ADD COLUMN IF NOT EXISTS "priceCoins" INTEGER;

-- Coin packages (PRD §7/§8) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "GameCoinPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coins" INTEGER NOT NULL,
    "bonusCoins" INTEGER NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0.99,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "badge" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "premiumOnly" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameCoinPackage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GameCoinPackage_isActive_sortOrder_idx"
    ON "GameCoinPackage"("isActive", "sortOrder");

-- Universal real-money purchase ledger (PRD §13) ────────────────────────────
CREATE TABLE IF NOT EXISTS "GamePurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "providerTransactionId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "coins" INTEGER,
    "bonusCoins" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "metadata" TEXT,
    CONSTRAINT "GamePurchase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GamePurchase_provider_providerTransactionId_key"
    ON "GamePurchase"("provider", "providerTransactionId");
CREATE INDEX IF NOT EXISTS "GamePurchase_userId_status_idx" ON "GamePurchase"("userId", "status");
CREATE INDEX IF NOT EXISTS "GamePurchase_productType_status_idx" ON "GamePurchase"("productType", "status");
CREATE INDEX IF NOT EXISTS "GamePurchase_createdAt_idx" ON "GamePurchase"("createdAt");
ALTER TABLE "GamePurchase" ADD CONSTRAINT "GamePurchase_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
    NOT VALID;

-- Real-money crate products (PRD §37-§43) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "CrateProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "crateType" TEXT NOT NULL DEFAULT 'PREMIUM',
    "price" DOUBLE PRECISION NOT NULL DEFAULT 4.99,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "emoji" TEXT NOT NULL DEFAULT '💎',
    "imageUrl" TEXT,
    "realmPoints" INTEGER NOT NULL DEFAULT 0,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "giftItemId" TEXT,
    "giftQuantity" INTEGER NOT NULL DEFAULT 1,
    "cosmeticRewardId" TEXT,
    "bonusLabel" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrateProduct_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CrateProduct_isActive_sortOrder_idx"
    ON "CrateProduct"("isActive", "sortOrder");

-- Crate entitlements: OWNED (paid) → OPENED (granted exactly once, §46) ─────
CREATE TABLE IF NOT EXISTS "CratePurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "crateProductId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OWNED',
    "rewards" TEXT,
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CratePurchase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CratePurchase_userId_status_idx" ON "CratePurchase"("userId", "status");
ALTER TABLE "CratePurchase" ADD CONSTRAINT "CratePurchase_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
    NOT VALID;
ALTER TABLE "CratePurchase" ADD CONSTRAINT "CratePurchase_crateProductId_fkey"
    FOREIGN KEY ("crateProductId") REFERENCES "CrateProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE
    NOT VALID;

-- Final-hours realm boost config (PRD §22-§24/§64/§65) ──────────────────────
CREATE TABLE IF NOT EXISTS "RealmBoostConfig" (
    "id" TEXT NOT NULL,
    "realmLevel" INTEGER,
    "hoursBeforeEnd" DOUBLE PRECISION NOT NULL DEFAULT 4,
    "multiplier" INTEGER NOT NULL DEFAULT 2,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RealmBoostConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RealmBoostConfig_realmLevel_key" ON "RealmBoostConfig"("realmLevel");

-- Monetization funnel events (PRD §59-§62) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "GameMonetizationEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameMonetizationEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GameMonetizationEvent_type_createdAt_idx"
    ON "GameMonetizationEvent"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "GameMonetizationEvent_userId_createdAt_idx"
    ON "GameMonetizationEvent"("userId", "createdAt");

-- Default boost seed (idempotent): 2× during the last 4 hours of every cycle.
INSERT INTO "RealmBoostConfig" ("id", "realmLevel", "hoursBeforeEnd", "multiplier", "enabled")
SELECT 'rbc-default', NULL, 4, 2, true
WHERE NOT EXISTS (SELECT 1 FROM "RealmBoostConfig" WHERE "realmLevel" IS NULL);
