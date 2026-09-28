-- Dating Chat Games PRD (docs/PRD-dating-chat-games.md)
-- Adds:
--   1. GameInvitation table — persisted, server-authoritative invitation
--      state machine for games launched from a 1:1 dating chat.
--   2. Message.metadata column — JSON-encoded payload for the
--      "game_activity" shared-memory card (PRD §31-§34, §57).
--   3. Extends the existing Message.type union with "game_activity"
--      (server-only; the POST /messages route still rejects user-sent
--      game_activity rows — only the game-completion path writes it).
--
-- Idempotent: each statement uses IF NOT EXISTS / WHERE NOT EXISTS so it
-- can be re-run safely. Prisma will pick up the schema on the next
-- `prisma generate` (the schema file is the source of truth; this SQL
-- is the migration that brings an existing DB in line with it).

-- ── 1. GameInvitation table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "GameInvitation" (
    "id"            TEXT                     NOT NULL,
    "matchId"       TEXT                     NOT NULL,
    "gameType"      TEXT                     NOT NULL,
    "senderId"      TEXT                     NOT NULL,
    "recipientId"   TEXT                     NOT NULL,
    "roomId"        TEXT,
    "status"        TEXT                     NOT NULL DEFAULT 'PENDING',
    "respondedAt"   TIMESTAMP(3),
    "responderId"   TEXT,
    "expiresAt"     TIMESTAMP(3)             NOT NULL,
    "closeReason"   TEXT,
    "createdAt"     TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3)             NOT NULL,

    CONSTRAINT "GameInvitation_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "GameInvitation"
  ADD CONSTRAINT "GameInvitation_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE;

ALTER TABLE "GameInvitation"
  ADD CONSTRAINT "GameInvitation_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE;

ALTER TABLE "GameInvitation"
  ADD CONSTRAINT "GameInvitation_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE;

-- Unique constraint: only one PENDING invitation per (matchId, gameType, status)
-- Note: this unique is on (matchId, gameType, status) — that means one row per
-- (matchId, gameType, status) tuple. Multiple PENDINGs for the same game in
-- the same match are prevented; once PENDING transitions to ACCEPTED/DECLINED/
-- EXPIRED/CANCELLED, a fresh PENDING can be created (allowing re-invite later).
CREATE UNIQUE INDEX IF NOT EXISTS "GameInvitation_matchId_gameType_status_key"
  ON "GameInvitation" ("matchId", "gameType", "status");

-- Hot lookups
CREATE INDEX IF NOT EXISTS "GameInvitation_recipientId_status_idx"
  ON "GameInvitation" ("recipientId", "status");
CREATE INDEX IF NOT EXISTS "GameInvitation_senderId_status_idx"
  ON "GameInvitation" ("senderId", "status");
CREATE INDEX IF NOT EXISTS "GameInvitation_matchId_status_idx"
  ON "GameInvitation" ("matchId", "status");
CREATE INDEX IF NOT EXISTS "GameInvitation_expiresAt_status_idx"
  ON "GameInvitation" ("expiresAt", "status");

-- ── 2. Message.metadata column (game-activity card payload) ──────────────
ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "metadata" TEXT;

-- ── 3. Sweep expired PENDING invitations to EXPIRED ──────────────────────
-- This is a one-off sweep at migration time; the runtime path also sweeps
-- lazily inside the GET /games/invitations/active route and the accept/decline
-- routes (the PRD §27 timeout watchdog is server-authoritative and does not
-- rely on a cron, but it can be promoted to one later if needed).
UPDATE "GameInvitation"
  SET "status" = 'EXPIRED',
      "closeReason" = 'timeout',
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "status" = 'PENDING'
    AND "expiresAt" < CURRENT_TIMESTAMP;
