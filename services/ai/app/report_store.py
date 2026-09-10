"""Reads and writes reports / report_claims in Supabase."""

import asyncio
import logging

from app.db import get_client

logger = logging.getLogger("relay.report_store")


async def next_version(transport_id: str) -> int:
    def _select() -> int:
        result = (
            get_client()
            .table("reports")
            .select("version")
            .eq("transport_id", transport_id)
            .order("version", desc=True)
            .limit(1)
            .execute()
        )
        if not result.data:
            return 1
        return result.data[0]["version"] + 1

    return await asyncio.to_thread(_select)


async def insert_report(
    *,
    transport_id: str,
    version: int,
    soap: dict,
    fhir_payload: dict,
) -> str:
    """Returns the new report's id."""

    def _insert() -> str:
        result = (
            get_client()
            .table("reports")
            .insert(
                {
                    "transport_id": transport_id,
                    "version": version,
                    "soap": soap,
                    "fhir_payload": fhir_payload,
                }
            )
            .execute()
        )
        return result.data[0]["id"]

    return await asyncio.to_thread(_insert)


async def insert_claims(claims: list[dict]) -> None:
    if not claims:
        return

    def _insert() -> None:
        get_client().table("report_claims").insert(claims).execute()

    try:
        await asyncio.to_thread(_insert)
    except Exception:
        logger.exception("failed to insert report claims")
