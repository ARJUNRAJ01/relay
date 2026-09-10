-- Any authenticated user (in practice: a medic starting a transport at an
-- MCI scene) can open a new incident. Closing/editing isn't exposed yet —
-- out of scope for this pass, same as it was for creating transports.
create policy incidents_insert on incidents
  for insert with check ((select auth.role()) = 'authenticated');
