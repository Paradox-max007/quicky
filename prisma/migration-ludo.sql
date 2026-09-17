-- Quicky — PRD: Quicky Ludo (4-player room-based Ludo on the shared room table)
-- Run against the Supabase/Postgres database before deploying the app update.
--
-- 1) SpinRoom becomes the SHARED room platform ("the room is the platform,
--    the game is a plug-in" — Ludo PRD §122):
--      · gameType  — which engine owns the room ("spin_bottle" | "ludo")
--      · gameState — authoritative LudoGameState jsonb (Ludo PRD §77: only
--        players/turn/dice/tokens/winner/stateVersion/sixStreak — never
--        animation frames)
-- 2) User gains permanent lifetime Ludo counters (Ludo PRD §74/§78): rooms
--    cascade away when closed, a player's lifetime totals must never change.
-- 3) Game catalog: "ludo" becomes the playable "Quicky Ludo" (2-4 players,
--    GROUP mode — Ludo PRD §71/§72/§108). Idempotent upsert.
-- Idempotent: safe to run more than once.

-- ── 1. Shared room platform columns ────────────────────────────────────────
ALTER TABLE "SpinRoom" ADD COLUMN IF NOT EXISTS "gameType"  TEXT NOT NULL DEFAULT 'spin_bottle';
ALTER TABLE "SpinRoom" ADD COLUMN IF NOT EXISTS "gameState" JSONB;

CREATE INDEX IF NOT EXISTS "SpinRoom_gameType_status_lastActivityAt_idx"
  ON "SpinRoom"("gameType", "status", "lastActivityAt");

-- ── 2. Permanent Ludo lifetime stats ───────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ludoWins"           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ludoTokensFinished" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ludoCaptures"       INTEGER NOT NULL DEFAULT 0;

-- ── 3. Game catalog: Quicky Ludo goes live ─────────────────────────────────
INSERT INTO "GameDefinition" (
  "id", "slug", "name", "shortDescription", "description", "icon", "artwork",
  "supportedModes", "minPlayers", "maxPlayers", "isPlayable", "isFeatured",
  "sortOrder", "createdAt", "updatedAt"
)
VALUES (
  gen_random_uuid(),
  'ludo',
  'Quicky Ludo',
  'Classic 4-player Ludo — dice, captures and a race to home.',
  'The classic board game inside the Quicky game room. Up to 4 players per table, server-authoritative dice and moves, real-time tokens, chat, gifts and mentions. Roll a 6 to start a token, capture opponents on unsafe squares, and bring all four tokens home to win.',
  '🎲',
  'gold',
  'GROUP',
  2,
  4,
  true,
  true,
  2,
  NOW(),
  NOW()
)
ON CONFLICT ("slug") DO UPDATE SET
  "name"            = 'Quicky Ludo',
  "shortDescription" = 'Classic 4-player Ludo — dice, captures and a race to home.',
  "description"     = 'The classic board game inside the Quicky game room. Up to 4 players per table, server-authoritative dice and moves, real-time tokens, chat, gifts and mentions. Roll a 6 to start a token, capture opponents on unsafe squares, and bring all four tokens home to win.',
  "icon"            = '🎲',
  "artwork"         = 'gold',
  "supportedModes"  = 'GROUP',
  "minPlayers"      = 2,
  "maxPlayers"      = 4,
  "isPlayable"      = true,
  "updatedAt"       = NOW();
