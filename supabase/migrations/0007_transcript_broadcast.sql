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
