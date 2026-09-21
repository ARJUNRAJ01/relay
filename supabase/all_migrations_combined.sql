-- Relay pilot schema.
-- Isolated Supabase project: no tables shared with any other system.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Org entities
-- ---------------------------------------------------------------------------

create table units (
  id uuid primary key default gen_random_uuid(),
  callsign text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table hospitals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);

-- One row per authenticated user, extending auth.users.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('medic', 'hospital_staff', 'dispatcher', 'admin')),
  full_name text not null,
  unit_id uuid references units (id) on delete set null,
  hospital_id uuid references hospitals (id) on delete set null,
  created_at timestamptz not null default now()
);

create index profiles_unit_id_idx on profiles (unit_id);
create index profiles_hospital_id_idx on profiles (hospital_id);

-- ---------------------------------------------------------------------------
-- Core clinical pipeline
-- ---------------------------------------------------------------------------

create table incidents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table transports (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units (id),
  hospital_id uuid not null references hospitals (id),
  incident_id uuid references incidents (id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'handed_off', 'completed', 'cancelled')),
  started_at timestamptz not null default now(),
  eta timestamptz,
  acuity smallint check (acuity between 1 and 5),
  created_at timestamptz not null default now()
);

create index transports_hospital_id_idx on transports (hospital_id);
create index transports_unit_id_idx on transports (unit_id);
create index transports_incident_id_idx on transports (incident_id);
create index transports_status_idx on transports (status);

create table transcript_segments (
  id uuid primary key default gen_random_uuid(),
  transport_id uuid not null references transports (id) on delete cascade,
  speaker text not null check (speaker in ('medic', 'medic_2', 'patient', 'bystander', 'unknown')),
  text text not null,
  original_text text not null,
  language text not null default 'en',
  confidence real not null check (confidence between 0 and 1),
  t_start double precision not null,
  t_end double precision not null,
  created_at timestamptz not null default now()
);

create index transcript_segments_transport_id_idx on transcript_segments (transport_id, t_start);

create table device_events (
  id uuid primary key default gen_random_uuid(),
  transport_id uuid not null references transports (id) on delete cascade,
  kind text not null,
  value jsonb not null,
  confidence real not null check (confidence between 0 and 1),
  detected_at timestamptz not null default now()
);

create index device_events_transport_id_idx on device_events (transport_id, detected_at);

create table reports (
  id uuid primary key default gen_random_uuid(),
  transport_id uuid not null references transports (id) on delete cascade,
  version integer not null,
  soap jsonb not null,
  fhir_payload jsonb,
  generated_at timestamptz not null default now(),
  signed_by uuid references profiles (id),
  signed_at timestamptz,
  unique (transport_id, version)
);

create index reports_transport_id_idx on reports (transport_id, version desc);

create table report_claims (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports (id) on delete cascade,
  field text not null,
  value jsonb not null,
  source_segment_ids uuid[] not null default '{}',
  confidence real not null check (confidence between 0 and 1),
  human_override jsonb,
  created_at timestamptz not null default now()
);

create index report_claims_report_id_idx on report_claims (report_id);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  transport_id uuid not null references transports (id) on delete cascade,
  kind text not null check (kind in ('protocol_match', 'deterioration', 'contraindication')),
  payload jsonb not null,
  fired_at timestamptz not null default now(),
  acknowledged_by uuid references profiles (id),
  acknowledged_at timestamptz
);

create index alerts_transport_id_idx on alerts (transport_id, fired_at desc);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  transport_id uuid references transports (id) on delete cascade,
  actor text not null,
  action text not null,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

create index audit_log_transport_id_idx on audit_log (transport_id, at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table units enable row level security;
alter table hospitals enable row level security;
alter table profiles enable row level security;
alter table incidents enable row level security;
alter table transports enable row level security;
alter table transcript_segments enable row level security;
alter table device_events enable row level security;
alter table reports enable row level security;
alter table report_claims enable row level security;
alter table alerts enable row level security;
alter table audit_log enable row level security;

-- Helper: current user's profile row, evaluated once per statement.
create or replace function current_profile()
returns profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- profiles: a user can read their own row; admins read all.
create policy profiles_select on profiles
  for select using (id = auth.uid() or is_admin());

create policy profiles_update_self on profiles
  for update using (id = auth.uid());

-- units / hospitals: any authenticated user can read (needed for pickers, boards).
create policy units_select on units for select using (auth.role() = 'authenticated');
create policy hospitals_select on hospitals for select using (auth.role() = 'authenticated');

-- incidents: readable by anyone authenticated (MCI mode is fleet/hospital-wide visibility).
create policy incidents_select on incidents for select using (auth.role() = 'authenticated');

-- transports: medics see their unit's runs, hospital staff see runs incoming to their hospital.
create policy transports_select on transports
  for select using (
    is_admin()
    or unit_id = (select unit_id from current_profile())
    or hospital_id = (select hospital_id from current_profile())
  );

create policy transports_insert on transports
  for insert with check (
    unit_id = (select unit_id from current_profile())
  );

create policy transports_update on transports
  for update using (
    is_admin()
    or unit_id = (select unit_id from current_profile())
    or hospital_id = (select hospital_id from current_profile())
  );

-- Child tables inherit visibility from their parent transport.
create policy transcript_segments_select on transcript_segments
  for select using (
    exists (
      select 1 from transports t
      where t.id = transcript_segments.transport_id
        and (
          is_admin()
          or t.unit_id = (select unit_id from current_profile())
          or t.hospital_id = (select hospital_id from current_profile())
        )
    )
  );

create policy device_events_select on device_events
  for select using (
    exists (
      select 1 from transports t
      where t.id = device_events.transport_id
        and (
          is_admin()
          or t.unit_id = (select unit_id from current_profile())
          or t.hospital_id = (select hospital_id from current_profile())
        )
    )
  );

create policy reports_select on reports
  for select using (
    exists (
      select 1 from transports t
      where t.id = reports.transport_id
        and (
          is_admin()
          or t.unit_id = (select unit_id from current_profile())
          or t.hospital_id = (select hospital_id from current_profile())
        )
    )
  );

create policy reports_update_sign on reports
  for update using (
    exists (
      select 1 from transports t
      where t.id = reports.transport_id
        and (is_admin() or t.hospital_id = (select hospital_id from current_profile()))
    )
  );

create policy report_claims_select on report_claims
  for select using (
    exists (
      select 1 from reports r
      join transports t on t.id = r.transport_id
      where r.id = report_claims.report_id
        and (
          is_admin()
          or t.unit_id = (select unit_id from current_profile())
          or t.hospital_id = (select hospital_id from current_profile())
        )
    )
  );

create policy report_claims_update_override on report_claims
  for update using (
    exists (
      select 1 from reports r
      join transports t on t.id = r.transport_id
      where r.id = report_claims.report_id
        and (
          is_admin()
          or t.unit_id = (select unit_id from current_profile())
          or t.hospital_id = (select hospital_id from current_profile())
        )
    )
  );

create policy alerts_select on alerts
  for select using (
    exists (
      select 1 from transports t
      where t.id = alerts.transport_id
        and (
          is_admin()
          or t.unit_id = (select unit_id from current_profile())
          or t.hospital_id = (select hospital_id from current_profile())
        )
    )
  );

create policy alerts_ack on alerts
  for update using (
    exists (
      select 1 from transports t
      where t.id = alerts.transport_id
        and (is_admin() or t.hospital_id = (select hospital_id from current_profile()))
    )
  );

-- audit_log: read-only for humans, scoped like its transport. Writes come from the
-- service role (AI service, server actions) which bypasses RLS entirely.
create policy audit_log_select on audit_log
  for select using (
    is_admin()
    or exists (
      select 1 from transports t
      where t.id = audit_log.transport_id
        and (
          t.unit_id = (select unit_id from current_profile())
          or t.hospital_id = (select hospital_id from current_profile())
        )
    )
  );
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
-- audit_log had a select policy but no insert policy, so app-initiated audit
-- writes (via the anon/authenticated role, not the service key) were
-- silently rejected by RLS. Scope inserts the same way selects are scoped.
create policy audit_log_insert on audit_log
  for insert with check (
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
-- The medic and hospital screens both subscribe to transcript_segments via
-- Supabase Realtime (postgres_changes). Tables aren't in the realtime
-- publication by default — this is what actually turns on live updates.
alter publication supabase_realtime add table transcript_segments;
-- Supabase Realtime's postgres_changes replication poller runs its RLS
-- check under a role that isn't `authenticated` — confirmed via this
-- project's realtime_logs: "permission denied for function current_profile"
-- (insufficient_privilege), thrown from realtime.apply_rls every time it
-- tried to evaluate our policies. Since current_profile()/is_admin() only
-- had EXECUTE granted to `authenticated` (migration 0002), this silently
-- dropped every live update for every viewer, medic and hospital staff
-- included — not just anon.
--
-- Moving these functions to the `private` schema (0002) already keeps them
-- off PostgREST's exposed API surface — private isn't in the exposed schema
-- list, so nothing regains a public /rest/v1/rpc/ entry point from this.
-- That was the actual point of the original anon/authenticated-only grant,
-- so it's safe to open EXECUTE (and schema USAGE) up broadly now.
grant usage on schema private to public;
grant execute on function private.current_profile() to public;
grant execute on function private.is_admin() to public;
-- Live transcript delivery uses Broadcast-from-Postgres, not
-- postgres_changes. Even after 0006's permission fix, this project's
-- postgres_changes replication poller (WAL-polling CDC) never recovered —
-- confirmed via realtime_logs: the connection errored repeatedly, then went
-- silent and stopped delivering entirely, including to properly
-- authenticated clients, even after the publication was reset. Broadcast is
-- also Supabase's currently recommended approach for this and doesn't
-- depend on that poller at all.
--
-- The trigger function lives in `private`, not `public`, for the same
-- reason as 0002's functions: a SECURITY DEFINER function in an
-- API-exposed schema is directly callable via /rest/v1/rpc/, which the
-- security advisor flags even though Postgres itself refuses to run a
-- trigger function outside trigger context.
create or replace function private.transcript_segments_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.broadcast_changes(
    'transcript:' || coalesce(new.transport_id, old.transport_id)::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return coalesce(new, old);
end;
$$;

create trigger transcript_segments_broadcast_trigger
  after insert on transcript_segments
  for each row execute function private.transcript_segments_broadcast();

-- Realtime Authorization: a client may only listen on topic
-- 'transcript:<transport_id>' if it could already select that transport's
-- transcript_segments rows directly — same scoping as transcript_segments_select.
create policy "transcript broadcast read access" on realtime.messages
  for select
  to authenticated
  using (
    exists (
      select 1 from transports t
      where t.id::text = split_part(realtime.topic(), ':', 2)
        and (
          private.is_admin()
          or t.unit_id = (select unit_id from private.current_profile())
          or t.hospital_id = (select hospital_id from private.current_profile())
        )
    )
  );
-- Same Broadcast-from-Postgres pattern as 0007, for the live SOAP report:
-- reports (new versions) and report_claims (each field's traceable value).
-- Both broadcast on the 'reports:<transport_id>' topic so the hospital view
-- can subscribe once and get both.
create or replace function private.reports_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.broadcast_changes(
    'reports:' || coalesce(new.transport_id, old.transport_id)::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return coalesce(new, old);
end;
$$;

create trigger reports_broadcast_trigger
  after insert or update on reports
  for each row execute function private.reports_broadcast();

create or replace function private.report_claims_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transport_id uuid;
begin
  select transport_id into v_transport_id from reports where id = coalesce(new.report_id, old.report_id);
  perform realtime.broadcast_changes(
    'reports:' || v_transport_id::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return coalesce(new, old);
end;
$$;

create trigger report_claims_broadcast_trigger
  after insert or update on report_claims
  for each row execute function private.report_claims_broadcast();

-- One policy covers both this topic namespace and transcript's (0007),
-- with an explicit prefix check — an earlier draft of this policy and
-- 0007's checked only "whatever's after the first colon" without
-- confirming the prefix matched their own namespace, which (since RLS
-- policies OR together) meant either alone would authorize a read on any
-- topic shaped like '<anything>:<transport-id-i-have-access-to>'. Not
-- exploitable with only these two namespaces in existence, but replaced
-- outright rather than left sloppy.
drop policy "transcript broadcast read access" on realtime.messages;

create policy "transport broadcast read access" on realtime.messages
  for select
  to authenticated
  using (
    (realtime.topic() like 'transcript:%' or realtime.topic() like 'reports:%')
    and exists (
      select 1 from transports t
      where t.id::text = split_part(realtime.topic(), ':', 2)
        and (
          private.is_admin()
          or t.unit_id = (select unit_id from private.current_profile())
          or t.hospital_id = (select hospital_id from private.current_profile())
        )
    )
  );
-- Phase 5: alerts. on_call_phone is a pilot-scope simplification — one
-- paging number per hospital, not per team/protocol (a real system would
-- route a STEMI page to cath lab, a stroke page to neuro, etc).
alter table hospitals add column on_call_phone text;

-- Same Broadcast-from-Postgres pattern as 0007/0008.
create or replace function private.alerts_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.broadcast_changes(
    'alerts:' || coalesce(new.transport_id, old.transport_id)::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return coalesce(new, old);
end;
$$;

create trigger alerts_broadcast_trigger
  after insert or update on alerts
  for each row execute function private.alerts_broadcast();

-- Extend the shared topic-authorization policy (0008) to also cover
-- 'alerts:<transport_id>'.
drop policy "transport broadcast read access" on realtime.messages;

create policy "transport broadcast read access" on realtime.messages
  for select
  to authenticated
  using (
    (realtime.topic() like 'transcript:%' or realtime.topic() like 'reports:%' or realtime.topic() like 'alerts:%')
    and exists (
      select 1 from transports t
      where t.id::text = split_part(realtime.topic(), ':', 2)
        and (
          private.is_admin()
          or t.unit_id = (select unit_id from private.current_profile())
          or t.hospital_id = (select hospital_id from private.current_profile())
        )
    )
  );
-- Any authenticated user (in practice: a medic starting a transport at an
-- MCI scene) can open a new incident. Closing/editing isn't exposed yet —
-- out of scope for this pass, same as it was for creating transports.
create policy incidents_insert on incidents
  for insert with check ((select auth.role()) = 'authenticated');
