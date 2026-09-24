-- Quicky — FCM push tokens + rewarded ads + super-like notification toggle
--
-- Apply with:  npx prisma db push
-- (this file documents the change for review / manual application)

-- Notification settings: separate Super Likes toggle
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "notifSuperLikes" BOOLEAN NOT NULL DEFAULT true;

-- One row per installed device/browser (web FCM SDK / Capacitor Firebase Messaging).
CREATE TABLE IF NOT EXISTS "PushToken" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "token"      TEXT NOT NULL,
    "platform"   TEXT NOT NULL DEFAULT 'web',
    "active"     BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- a token belongs to exactly ONE install
CREATE UNIQUE INDEX IF NOT EXISTS "PushToken_token_key" ON "PushToken"("token");
CREATE INDEX IF NOT EXISTS "PushToken_userId_active_idx" ON "PushToken"("userId", "active");

ALTER TABLE "PushToken" DROP CONSTRAINT IF EXISTS "PushToken_userId_fkey";
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

-- Every granted rewarded-ad reward (coins or realm points, 1-1000, server-generated)
CREATE TABLE IF NOT EXISTS "AdRewardEvent" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "amount"    INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdRewardEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdRewardEvent_userId_createdAt_idx" ON "AdRewardEvent"("userId", "createdAt");

ALTER TABLE "AdRewardEvent" DROP CONSTRAINT IF EXISTS "AdRewardEvent_userId_fkey";
ALTER TABLE "AdRewardEvent" ADD CONSTRAINT "AdRewardEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
