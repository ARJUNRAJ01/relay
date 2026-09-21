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
