"""Shared Supabase client for the AI service. Uses the service role key —
this is a trusted backend service writing on behalf of the system, not a
user request, so RLS is intentionally bypassed here (the web app's own
reads/writes go through RLS as the signed-in user; this is the one place
that doesn't, by design)."""

from supabase import Client, create_client

from app.settings import settings

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _client
