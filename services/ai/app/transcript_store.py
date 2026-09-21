"""Reads and writes transcript_segments in Supabase."""

import asyncio
import logging

from app.db import get_client

logger = logging.getLogger("relay.transcript_store")


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
        get_client().table("transcript_segments").insert(
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


async def list_segments(transport_id: str) -> list[dict]:
    def _select() -> list[dict]:
        result = (
            get_client()
            .table("transcript_segments")
            .select("*")
            .eq("transport_id", transport_id)
            .order("t_start")
            .execute()
        )
        return result.data or []

    return await asyncio.to_thread(_select)
