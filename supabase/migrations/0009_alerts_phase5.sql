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
