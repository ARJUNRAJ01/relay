import logging

from fastapi import Depends, FastAPI, File, Form, UploadFile
from pydantic import BaseModel

from app import capture, reconcile
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


@app.post("/transports/{transport_id}/reconcile-audio", dependencies=[Depends(require_shared_secret)])
async def reconcile_audio(
    transport_id: str,
    audio: UploadFile = File(...),
    identity: str = Form(...),
    speaker: str = Form(...),
    gap_start_s: float = Form(...),
) -> dict[str, str]:
    webm_bytes = await audio.read()
    await reconcile.reconcile_audio(
        transport_id=transport_id,
        identity=identity,
        speaker=speaker,
        webm_bytes=webm_bytes,
        gap_start_s=gap_start_s,
    )
    return {"status": "reconciled"}
