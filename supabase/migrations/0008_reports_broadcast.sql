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
