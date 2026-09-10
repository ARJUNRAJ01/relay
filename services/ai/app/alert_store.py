"""Reads and writes alerts, and looks up who to page for a transport."""

import asyncio
import logging

from app.db import get_client

logger = logging.getLogger("relay.alert_store")


async def insert_alert(*, transport_id: str, kind: str, payload: dict) -> None:
    def _insert() -> None:
        get_client().table("alerts").insert(
            {"transport_id": transport_id, "kind": kind, "payload": payload}
        ).execute()

    try:
        await asyncio.to_thread(_insert)
    except Exception:
        logger.exception("failed to insert alert (kind=%s) for transport %s", kind, transport_id)


async def get_paging_target(transport_id: str) -> tuple[str | None, str | None]:
    """Returns (on_call_phone, unit_callsign) for the transport's receiving
    hospital, or (None, None) if the transport can't be found."""

    def _select() -> tuple[str | None, str | None]:
        result = (
            get_client()
            .table("transports")
            .select("hospitals(on_call_phone), units(callsign)")
            .eq("id", transport_id)
            .maybe_single()
            .execute()
        )
        if not result.data:
            return None, None
        hospital = result.data.get("hospitals") or {}
        unit = result.data.get("units") or {}
        return hospital.get("on_call_phone"), unit.get("callsign")

    return await asyncio.to_thread(_select)
