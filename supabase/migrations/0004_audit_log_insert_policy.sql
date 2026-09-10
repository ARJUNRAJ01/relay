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
