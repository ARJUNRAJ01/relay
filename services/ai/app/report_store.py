"""Reads and writes reports / report_claims in Supabase."""

import asyncio
import logging

from app.db import get_client

logger = logging.getLogger("relay.report_store")


async def get_latest(transport_id: str) -> dict | None:
    """The most recent report version, if any — used both to compute the
    next version number and (by app/alerts.py) as the "before" side of a
    deterioration comparison against the report being generated now."""

    def _select() -> dict | None:
        result = (
            get_client()
            .table("reports")
            .select("version, soap")
            .eq("transport_id", transport_id)
            .order("version", desc=True)
            .limit(1)
            .execute()
        )
        return result.data[0] if result.data else None

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
