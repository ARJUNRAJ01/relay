-- Local/dev seed data. Not run automatically against the pilot project;
-- apply by hand (or via `supabase db reset`) when you need a clean sandbox.

insert into units (callsign, name) values
  ('MEDIC-7', 'Riverside EMS Unit 7')
on conflict (callsign) do nothing;

insert into hospitals (name, timezone) values
  ('St. Cross Regional Medical Center', 'America/New_York')
on conflict do nothing;

-- After seeding, create an auth user (dashboard, or supabase.auth.admin.createUser)
-- and insert a matching row into `profiles` with that user's id, e.g.:
--
--   insert into profiles (id, role, full_name, unit_id)
--   values ('<auth-user-id>', 'medic', 'Demo Medic',
--     (select id from units where callsign = 'MEDIC-7'));
