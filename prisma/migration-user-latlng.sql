-- User lat/lng migration (Premium Party Games PRD §B / location capture)
--
-- The Prisma schema already declares `lat Float?` and `lng Float?` on the
-- User model (lines 27-28 of prisma/schema.prisma), but no migration file
-- ever added them to the live DB. This idempotent migration brings the DB
-- in line with the schema so `db.user.update({ data: { lat, lng } })` works
-- without throwing `column "lat" of relation "User" does not exist`.
--
-- The values stored are 2-decimal-rounded (imprecise to ~1km) so the
-- user's exact street isn't recoverable — see
-- src/lib/quicky/device-permissions.ts `imprecise()`. They're used for
-- the discovery distance filter (PRD: "for filtering with the distance we
-- need that location data").

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION;

-- Index for future proximity queries (optional but cheap; helps if we
-- later move from client-side haversine to server-side radius filters).
CREATE INDEX IF NOT EXISTS "User_lat_lng_idx" ON "User" ("lat", "lng");
