-- Quicky — Supabase Realtime setup
-- Run once in the Supabase SQL editor.
--
-- The chat relies on Realtime postgres_changes INSERT events on the Message
-- table as a delivery safety net when a broadcast is missed. Supabase only
-- replicates tables that have been added to the supabase_realtime publication.

alter publication supabase_realtime add table "Message";

-- Match channels filter by matchId, so the replica identity must carry that
-- column (default index identity is enough for an INSERT-only subscription,
-- but setting it explicitly keeps UPDATE/DELETE usable later):
alter table "Message" replica identity full;
