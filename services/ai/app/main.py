import logging

from fastapi import Depends, FastAPI
from pydantic import BaseModel

from app import capture
from app.security import require_shared_secret
from app.settings import settings

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Relay AI Service")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "asr_provider": settings.asr_provider, "llm_provider": settings.llm_provider}


class StartCaptureRequest(BaseModel):
    room_name: str


@app.post("/transports/{transport_id}/start-capture", dependencies=[Depends(require_shared_secret)])
async def start_capture(transport_id: str, body: StartCaptureRequest) -> dict[str, str]:
    await capture.start_capture(transport_id, body.room_name)
    return {"status": "capturing"}


@app.post("/transports/{transport_id}/stop-capture", dependencies=[Depends(require_shared_secret)])
async def stop_capture(transport_id: str) -> dict[str, str]:
    await capture.stop_capture(transport_id)
    return {"status": "stopped"}
