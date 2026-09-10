"""Persists finalized transcript segments to Supabase. Uses the service
role key — this is a trusted backend service writing on behalf of the
system, not a user request, so RLS is intentionally bypassed here (the web
app's own reads/writes go through RLS as the signed-in user; this is the
one place that doesn't, by design)."""

import asyncio
import logging

from supabase import Client, create_client

from app.settings import settings

logger = logging.getLogger("relay.transcript_store")

_client: Client | None = None


def _get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _client


async def insert_segment(
    *,
    transport_id: str,
    speaker: str,
    text: str,
    original_text: str,
    language: str,
    confidence: float,
    t_start: float,
    t_end: float,
) -> None:
    def _insert() -> None:
        _get_client().table("transcript_segments").insert(
            {
                "transport_id": transport_id,
                "speaker": speaker,
                "text": text,
                "original_text": original_text,
                "language": language,
                "confidence": confidence,
                "t_start": t_start,
                "t_end": t_end,
            }
        ).execute()

    try:
        await asyncio.to_thread(_insert)
    except Exception:
        logger.exception("failed to insert transcript segment for transport %s", transport_id)
