"""SMS paging via Twilio — stubbed until real credentials are configured.

Phase 5 pilot decision: rather than requiring a Twilio account (and a way
to verify an SMS actually lands on a real phone, which isn't possible from
this dev environment anyway), paging is a log line until
TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER are all set.
Swapping in real credentials is the only change needed — this function's
call sites don't change.
"""

import logging

from app.settings import settings

logger = logging.getLogger("relay.paging")

_twilio_client = None


def _get_twilio_client():
    global _twilio_client
    if _twilio_client is None:
        from twilio.rest import Client

        _twilio_client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
    return _twilio_client


def _twilio_configured() -> bool:
    return bool(settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_from_number)


async def send_page(to: str | None, message: str) -> None:
    if not to:
        logger.warning("paging: no on-call number configured for this hospital, dropping page: %s", message)
        return

    if not _twilio_configured():
        logger.info("PAGING STUB (Twilio not configured) — would page %s: %s", to, message)
        return

    try:
        client = _get_twilio_client()
        client.messages.create(to=to, from_=settings.twilio_from_number, body=message)
        logger.info("paged %s: %s", to, message)
    except Exception:
        logger.exception("failed to send page to %s", to)
