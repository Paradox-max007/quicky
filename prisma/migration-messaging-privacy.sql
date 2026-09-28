-- Premium Party Games PRD — messaging privacy + free-limits migration
-- (PRD §13, §15, §18-§20, §46)
--
-- Adds the `allowAnyoneMessage` column to the UserSettings table so the
-- recipient can restrict new conversations to Friends / Connections only.
-- Default TRUE so existing users keep current behaviour ("anyone matched
-- can message"); turning it OFF (Privacy Settings → "Allow anyone to
-- message me") restricts NEW conversations only — existing ones continue
-- to work (PRD §20).
--
-- Idempotent. Run with: `npx prisma db push` (recommended), or paste into
-- the Supabase SQL editor.

ALTER TABLE "UserSettings"
  ADD COLUMN IF NOT EXISTS "allowAnyoneMessage" BOOLEAN NOT NULL DEFAULT TRUE;

-- ── GameInvitation table — already added by migration-dating-chat-games.sql;
--   this migration does not touch it. (Listed here for completeness only.)
