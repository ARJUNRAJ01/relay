"""ASRProvider interface: swap Cartesia for Deepgram (or anything else) with
one env var (ASR_PROVIDER) and no changes to capture.py. See CartesiaSession
for the reference implementation and its docstring for known gaps versus the
product spec (no diarization, no confidence score) that a future provider
needs to close.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Awaitable, Callable


@dataclass
class TranscriptChunk:
    text: str
    is_final: bool
    duration_s: float | None
    """Seconds of audio this chunk covers, if the provider reports it."""
    confidence: float
    """1.0 when the provider gives no real confidence signal — see the
    CARTESIA_NO_CONFIDENCE note in cartesia.py. Never trust this value for
    alert-gating decisions until that gap is closed."""


OnTranscript = Callable[[TranscriptChunk], Awaitable[None]]


class ASRSession(ABC):
    """One streaming session, bound to one participant's audio."""

    @abstractmethod
    async def send_audio(self, pcm16_bytes: bytes) -> None: ...

    @abstractmethod
    async def close(self) -> None: ...


def create_asr_session(
    *,
    sample_rate: int,
    num_channels: int,
    on_transcript: OnTranscript,
) -> ASRSession:
    from app.settings import settings

    if settings.asr_provider == "cartesia":
        from app.asr.cartesia import CartesiaSession

        return CartesiaSession(sample_rate=sample_rate, num_channels=num_channels, on_transcript=on_transcript)

    raise NotImplementedError(
        f"ASR_PROVIDER={settings.asr_provider!r} is not wired up yet — only 'cartesia' is implemented. "
        "Deepgram is the documented fallback (it also reports confidence and diarization, "
        "which Cartesia's streaming STT does not) but needs its own ASRSession implementation here."
    )
