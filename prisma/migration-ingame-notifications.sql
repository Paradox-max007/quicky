-- Quicky — IN-GAME NOTIFICATIONS TOGGLE (UserSettings.notifGameEvents)
--
-- Adds ONE boolean column to UserSettings. It gates the in-game alert layer
-- (src/components/quicky/game-alerts/GameAlertCenter.tsx):
--   · Ludo turn notification while the player is off the game screen
--     (Dismiss + Go to Game — returns to the live board at the exact round)
--   · Private game-chat message modal when the user is not in the sender's
--     chat screen (one-line preview + Reply)
--
-- Default TRUE (notifications on). Free for all users — this is a gameplay
-- surface, not a marketing preference, so it is NOT part of the premium-gated
-- notification keys.
--
-- Apply with either:
--   psql "$DATABASE_URL" -f prisma/migration-ingame-notifications.sql
--   (or) bun run db:push   -- after updating prisma/schema.prisma (done)

ALTER TABLE "UserSettings"
  ADD COLUMN IF NOT EXISTS "notifGameEvents" BOOLEAN NOT NULL DEFAULT true;
