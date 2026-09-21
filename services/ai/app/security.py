from fastapi import Header, HTTPException

from app.settings import settings


def require_shared_secret(x_relay_shared_secret: str = Header(default="")) -> None:
    if x_relay_shared_secret != settings.ai_service_shared_secret:
        raise HTTPException(status_code=401, detail="invalid shared secret")
