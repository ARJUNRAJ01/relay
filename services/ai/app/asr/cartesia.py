"""Cartesia Ink-Whisper streaming STT client.

Known gaps versus the product spec, confirmed against Cartesia's docs
(docs.cartesia.ai/api-reference/stt/stt) — flagged here rather than silently
worked around, per REGULATORY.md's "don't hide inconvenient gaps" stance:

- CARTESIA_NO_CONFIDENCE: the API returns no confidence/probability score at
  all, per-word or per-chunk. Every TranscriptChunk from this provider ships
  with confidence=1.0 as a placeholder. That is fine for phase 3 (transcript
  display only) but is NOT fine once phase 5 (alerts) reads transcript
  confidence to decide what can trigger a protocol-match alert — a real
  confidence signal has to land before that ships, either by switching the
  primary provider to Deepgram (which does report confidence) or by adding
  a proxy signal in front of this one.
- No diarization: a single audio track only ever produces one speaker's
  worth of text from Cartesia's perspective. Multi-device diarization
  (a second medic's phone as its own LiveKit participant) works today via
  the `speaker` passed in from capture.py; a patient/bystander talking into
  the same medic's phone mic cannot be separated by this provider.
- No language auto-detect or translation. Deferred to the phase 4 LLM step.
"""

import asyncio
import json
import logging

import websockets

from app.asr.base import ASRSession, OnTranscript, TranscriptChunk
from app.settings import settings

logger = logging.getLogger("relay.asr.cartesia")

_WS_URL = "wss://api.cartesia.ai/stt/websocket"
_CARTESIA_VERSION = "2026-08-14"


class CartesiaSession(ASRSession):
    def __init__(self, *, sample_rate: int, num_channels: int, on_transcript: OnTranscript) -> None:
        if num_channels != 1:
            raise ValueError("Cartesia streaming STT expects mono audio")
        self._sample_rate = sample_rate
        self._on_transcript = on_transcript
        self._ws: websockets.ClientConnection | None = None
        self._recv_task: asyncio.Task | None = None
        self._connected = asyncio.Event()

    async def _connect(self) -> None:
        url = (
            f"{_WS_URL}?model=ink-whisper&encoding=pcm_s16le"
            f"&sample_rate={self._sample_rate}&cartesia_version={_CARTESIA_VERSION}"
        )
        self._ws = await websockets.connect(url, additional_headers={"X-API-Key": settings.cartesia_api_key})
        self._recv_task = asyncio.create_task(self._receive_loop())
        self._connected.set()

    async def _receive_loop(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                message = json.loads(raw)
                if message.get("type") == "error":
                    logger.error("cartesia stt error: %s", message)
                    continue
                if message.get("type") != "transcript":
                    continue
                text = message.get("text", "")
                if not text:
                    continue
                await self._on_transcript(
                    TranscriptChunk(
                        text=text,
                        is_final=bool(message.get("is_final")),
                        duration_s=message.get("duration"),
                        confidence=1.0,  # see CARTESIA_NO_CONFIDENCE above
                    )
                )
        except websockets.exceptions.ConnectionClosed:
            logger.info("cartesia stt connection closed")
        except Exception:
            logger.exception("cartesia stt receive loop crashed")

    async def send_audio(self, pcm16_bytes: bytes) -> None:
        if self._ws is None:
            await self._connect()
            await self._connected.wait()
        assert self._ws is not None
        await self._ws.send(pcm16_bytes)

    async def close(self) -> None:
        if self._ws is None:
            return
        try:
            await self._ws.send("close")
        except websockets.exceptions.ConnectionClosed:
            pass
        if self._recv_task:
            try:
                await asyncio.wait_for(self._recv_task, timeout=2.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._recv_task.cancel()
        await self._ws.close()
