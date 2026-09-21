"""Phase 6: reconciles audio the medic app queued locally while
disconnected. The medic browser detects a LiveKit disconnect, records
locally (MediaRecorder → IndexedDB) for the duration of the outage, and on
reconnect uploads that recording here — a webm/opus blob plus the
transport-relative elapsed time the gap began at (`gap_start_s`, tracked
client-side).

This is a standalone one-shot pass, decoupled from the live RoomRecorder in
capture.py: it doesn't touch that object's state, which matters because the
gap being reconciled may have outlasted the recorder itself (e.g. the
transport ended while the medic was still offline). Live segments before
and after the gap already exist with their own correct t_start/t_end
(capture.py's cursor naturally pauses and resumes on its own — a dropped
participant just stops producing frames, then starts again); this only
needs to fill in the gap between them, which is why gap_start_s is enough
context and nothing needs to be coordinated with the live recorder.

Known gap, flagged not hidden: this reinserts audio into the timeline by
offset, not by re-deriving exact timestamps from the reconciled transcript,
so a gap whose actual duration doesn't match what the client reported would
skew segment boundaries after it. Good enough for a demo; a production
version would timestamp-anchor against the live segments immediately
before and after the gap instead of trusting the client's elapsed-time
tracking alone.
"""

import asyncio
import logging
import os
import subprocess

from app import report_generator, transcript_store
from app.asr.base import TranscriptChunk, create_asr_session
from app.settings import settings

logger = logging.getLogger("relay.reconcile")

_SAMPLE_RATE = 48000
_NUM_CHANNELS = 1
_FRAME_MS = 20
_FRAME_BYTES = _SAMPLE_RATE * _FRAME_MS // 1000 * 2  # 16-bit samples


async def reconcile_audio(
    *,
    transport_id: str,
    identity: str,
    speaker: str,
    webm_bytes: bytes,
    gap_start_s: float,
) -> None:
    pcm = await _decode_to_pcm16(webm_bytes)
    if not pcm:
        logger.warning("reconcile: ffmpeg produced no audio for transport %s", transport_id)
        return

    chunks: list[TranscriptChunk] = []

    async def on_transcript(chunk: TranscriptChunk) -> None:
        if chunk.is_final:
            chunks.append(chunk)

    asr = create_asr_session(sample_rate=_SAMPLE_RATE, num_channels=_NUM_CHANNELS, on_transcript=on_transcript)
    try:
        for i in range(0, len(pcm), _FRAME_BYTES):
            await asr.send_audio(pcm[i : i + _FRAME_BYTES])
    finally:
        await asr.close()
        # Cartesia flushes any buffered final transcript(s) as part of the
        # "close" handshake — give the receive loop a moment to process them
        # before we read `chunks`.
        await asyncio.sleep(0.5)

    if settings.audio_storage_backend == "local":
        directory = os.path.join(settings.audio_storage_dir, transport_id)
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, f"{identity}-reconciled-{gap_start_s:.1f}.wav")
        _write_wav(path, pcm)
        logger.info("reconcile: wrote %s", path)

    cursor = gap_start_s
    for chunk in chunks:
        t_start = cursor
        t_end = t_start + chunk.duration_s if chunk.duration_s is not None else t_start
        t_end = max(t_end, t_start)
        cursor = t_end
        await transcript_store.insert_segment(
            transport_id=transport_id,
            speaker=speaker,
            text=chunk.text,
            original_text=chunk.text,
            language="en",
            confidence=chunk.confidence,
            t_start=t_start,
            t_end=t_end,
        )

    logger.info(
        "reconcile: inserted %d segment(s) for transport %s starting at t=%.1fs",
        len(chunks),
        transport_id,
        gap_start_s,
    )
    if chunks:
        await report_generator.request_regeneration(transport_id)


async def _decode_to_pcm16(webm_bytes: bytes) -> bytes:
    # asyncio.create_subprocess_exec needs ProactorEventLoop on Windows;
    # uvicorn's loop here uses Selector (needed for other things in the
    # stack) and raises NotImplementedError on subprocess creation. A
    # blocking subprocess.run in a worker thread sidesteps that entirely
    # and works under any event loop.
    def _run() -> subprocess.CompletedProcess:
        return subprocess.run(
            [
                "ffmpeg",
                "-i", "pipe:0",
                "-f", "s16le",
                "-acodec", "pcm_s16le",
                "-ar", str(_SAMPLE_RATE),
                "-ac", str(_NUM_CHANNELS),
                "pipe:1",
            ],
            input=webm_bytes,
            capture_output=True,
        )

    result = await asyncio.to_thread(_run)
    if result.returncode != 0:
        logger.error("ffmpeg decode failed: %s", result.stderr.decode(errors="replace")[-2000:])
        return b""
    return result.stdout


def _write_wav(path: str, pcm: bytes) -> None:
    import wave

    writer = wave.open(path, "wb")
    writer.setnchannels(_NUM_CHANNELS)
    writer.setsampwidth(2)
    writer.setframerate(_SAMPLE_RATE)
    writer.writeframes(pcm)
    writer.close()
