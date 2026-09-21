-- Wrap auth.*() calls in (select ...) so Postgres evaluates them once per
-- statement instead of once per row (see: auth_rls_initplan advisor).

drop policy units_select on units;
create policy units_select on units for select using ((select auth.role()) = 'authenticated');

drop policy hospitals_select on hospitals;
create policy hospitals_select on hospitals for select using ((select auth.role()) = 'authenticated');

drop policy incidents_select on incidents;
create policy incidents_select on incidents for select using ((select auth.role()) = 'authenticated');

drop policy profiles_select on profiles;
create policy profiles_select on profiles
  for select using (id = (select auth.uid()) or private.is_admin());

drop policy profiles_update_self on profiles;
create policy profiles_update_self on profiles
  for update using (id = (select auth.uid()));

-- Missing covering indexes on foreign keys.
create index alerts_acknowledged_by_idx on alerts (acknowledged_by);
create index reports_signed_by_idx on reports (signed_by);
