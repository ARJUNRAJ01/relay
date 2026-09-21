-- Fix: current_profile() / is_admin() were SECURITY DEFINER functions in the
-- public schema, so PostgREST exposed them as callable RPC endpoints
-- (/rest/v1/rpc/current_profile, /rest/v1/rpc/is_admin). Moving them into a
-- private schema (not in PostgREST's exposed schema list) keeps them usable
-- inside RLS policies while closing the direct-call surface. See
-- supabase security advisors: anon/authenticated_security_definer_function_executable.

create schema if not exists private;
revoke usage on schema private from anon, authenticated;
grant usage on schema private to authenticated;

alter function public.current_profile() set schema private;
alter function public.is_admin() set schema private;

revoke execute on function private.current_profile() from public, anon;
revoke execute on function private.is_admin() from public, anon;
grant execute on function private.current_profile() to authenticated;
grant execute on function private.is_admin() to authenticated;

-- Recreate policies referencing the moved functions.
drop policy profiles_select on profiles;
create policy profiles_select on profiles
  for select using (id = auth.uid() or private.is_admin());

drop policy transports_select on transports;
create policy transports_select on transports
  for select using (
    private.is_admin()
    or unit_id = (select unit_id from private.current_profile())
    or hospital_id = (select hospital_id from private.current_profile())
  );

drop policy transports_insert on transports;
create policy transports_insert on transports
  for insert with check (
    unit_id = (select unit_id from private.current_profile())
  );

drop policy transports_update on transports;
create policy transports_update on transports
  for update using (
    private.is_admin()
    or unit_id = (select unit_id from private.current_profile())
    or hospital_id = (select hospital_id from private.current_profile())
  );

drop policy transcript_segments_select on transcript_segments;
create policy transcript_segments_select on transcript_segments
  for select using (
    exists (
      select 1 from transports t
      where t.id = transcript_segments.transport_id
        and (
          private.is_admin()
          or t.unit_id = (select unit_id from private.current_profile())
          or t.hospital_id = (select hospital_id from private.current_profile())
        )
    )
  );

drop policy device_events_select on device_events;
create policy device_events_select on device_events
  for select using (
    exists (
      select 1 from transports t
      where t.id = device_events.transport_id
        and (
          private.is_admin()
          or t.unit_id = (select unit_id from private.current_profile())
          or t.hospital_id = (select hospital_id from private.current_profile())
        )
    )
  );

drop policy reports_select on reports;
create policy reports_select on reports
  for select using (
    exists (
      select 1 from transports t
      where t.id = reports.transport_id
        and (
          private.is_admin()
          or t.unit_id = (select unit_id from private.current_profile())
          or t.hospital_id = (select hospital_id from private.current_profile())
        )
    )
  );

drop policy reports_update_sign on reports;
create policy reports_update_sign on reports
  for update using (
    exists (
      select 1 from transports t
      where t.id = reports.transport_id
        and (private.is_admin() or t.hospital_id = (select hospital_id from private.current_profile()))
    )
  );

drop policy report_claims_select on report_claims;
create policy report_claims_select on report_claims
  for select using (
    exists (
      select 1 from reports r
      join transports t on t.id = r.transport_id
      where r.id = report_claims.report_id
        and (
          private.is_admin()
          or t.unit_id = (select unit_id from private.current_profile())
          or t.hospital_id = (select hospital_id from private.current_profile())
        )
    )
  );

drop policy report_claims_update_override on report_claims;
create policy report_claims_update_override on report_claims
  for update using (
    exists (
      select 1 from reports r
      join transports t on t.id = r.transport_id
      where r.id = report_claims.report_id
        and (
          private.is_admin()
          or t.unit_id = (select unit_id from private.current_profile())
          or t.hospital_id = (select hospital_id from private.current_profile())
        )
    )
  );

drop policy alerts_select on alerts;
create policy alerts_select on alerts
  for select using (
    exists (
      select 1 from transports t
      where t.id = alerts.transport_id
        and (
          private.is_admin()
          or t.unit_id = (select unit_id from private.current_profile())
          or t.hospital_id = (select hospital_id from private.current_profile())
        )
    )
  );

drop policy alerts_ack on alerts;
create policy alerts_ack on alerts
  for update using (
    exists (
      select 1 from transports t
      where t.id = alerts.transport_id
        and (private.is_admin() or t.hospital_id = (select hospital_id from private.current_profile()))
    )
  );

drop policy audit_log_select on audit_log;
create policy audit_log_select on audit_log
  for select using (
    private.is_admin()
    or exists (
      select 1 from transports t
      where t.id = audit_log.transport_id
        and (
          t.unit_id = (select unit_id from private.current_profile())
          or t.hospital_id = (select hospital_id from private.current_profile())
        )
    )
  );
