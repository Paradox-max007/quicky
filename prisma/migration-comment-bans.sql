-- Quicky — community comment bans (PostCommentBan)
-- A post owner bans a commenter from commenting on ANY of the owner's posts
-- (past and future). Per-owner, NOT global — the banned user can still
-- comment on everyone else's posts.
--
-- Apply with:  npx prisma db push
-- (this file documents the change for review / manual application)

CREATE TABLE IF NOT EXISTS "PostCommentBan" (
    "id"        TEXT NOT NULL,
    "ownerId"   TEXT NOT NULL,
    "bannedId"  TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostCommentBan_pkey" PRIMARY KEY ("id")
);

-- one ban per (owner, banned) pair
CREATE UNIQUE INDEX IF NOT EXISTS "PostCommentBan_ownerId_bannedId_key"
    ON "PostCommentBan"("ownerId", "bannedId");
-- fast "am I banned?" lookups for the commenting user
CREATE INDEX IF NOT EXISTS "PostCommentBan_bannedId_idx"
    ON "PostCommentBan"("bannedId");

ALTER TABLE "PostCommentBan"
    ADD CONSTRAINT "PostCommentBan_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostCommentBan"
    ADD CONSTRAINT "PostCommentBan_bannedId_fkey"
    FOREIGN KEY ("bannedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
