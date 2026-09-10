-- The medic and hospital screens both subscribe to transcript_segments via
-- Supabase Realtime (postgres_changes). Tables aren't in the realtime
-- publication by default — this is what actually turns on live updates.
alter publication supabase_realtime add table transcript_segments;
