-- Quicky — ROOM CHAT MENTION SETTINGS (SpinRoomPlayer.mentionsEnabled)
--
-- Adds ONE boolean column to the room membership row (shared by BOTH room
-- games — Spin the Bottle and Ludo use the same SpinRoomPlayer table).
-- Room-chat settings revision:
--   · Chat panel Settings gear → "Allow mentions in this room" toggle
--     (default TRUE / on).
--   · When FALSE for a member, nobody in THAT room can mention them:
--       - their player toolbox hides the Mention action,
--       - the @ composer picker filters their name out,
--       - the room-chat POST drops mention rows targeting them (server-side
--         enforcement — no mention notification ever fires).
--   · The snapshot mirrors the flag per player so every client in the room
--     reacts the moment it flips (the toggle route wakes all SSE streams).
--
-- PER-ROOM by design: leaving the room forgets it; other rooms are untouched.
--
-- Apply with either:
--   psql "$DATABASE_URL" -f prisma/migration-room-mention-settings.sql
--   (or) bun run db:push   -- after updating prisma/schema.prisma (done)

ALTER TABLE "SpinRoomPlayer"
  ADD COLUMN IF NOT EXISTS "mentionsEnabled" BOOLEAN NOT NULL DEFAULT true;
