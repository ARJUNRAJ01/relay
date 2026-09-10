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
