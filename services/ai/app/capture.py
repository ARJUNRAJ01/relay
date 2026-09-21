"""Phase 2+3: audio capture and live transcription. A bot participant joins
the LiveKit room for a transport, subscribes to every remote participant's
microphone track, writes the raw PCM to a WAV file per participant (storage
is a local disk directory for the demo; swapping to R2 later means adding an
"r2" branch to `_open_writer`, not touching the capture loop), and streams
the same frames to an ASR provider for live transcription.

Speaker attribution: the LiveKit participant's metadata (set by the web app
when it mints that participant's join token) carries `{"speaker": "medic"}`.
That's the only diarization signal available — a second device (a second
medic's phone) is a distinct participant with its own metadata and gets
attributed correctly; a patient talking into the same medic's phone mic
cannot be separated from the medic by Cartesia's streaming STT (see
app/asr/cartesia.py's docstring) and falls back to "unknown".
"""

import asyncio
import json
import logging
import os
import wave
from dataclasses import dataclass, field

from livekit import api, rtc

from app import report_generator, transcript_store
from app.asr.base import ASRSession, TranscriptChunk, create_asr_session
from app.settings import settings

logger = logging.getLogger("relay.capture")

VALID_SPEAKERS = {"medic", "medic_2", "patient", "bystander", "unknown"}


@dataclass
class RoomRecorder:
    """One writer per participant identity, owned entirely by that
    participant's `_consume_audio` task. A track's AudioStream ends on its
    own when the participant leaves or the track is unpublished, so that's
    the only place a writer is opened, finalized, and closed — a separate
    `participant_disconnected` handler racing to close the same writer
    (the original design) could fire while a frame was still in flight,
    close the file, and have the next frame silently reopen (and truncate)
    it. `_finalized` stops a writer from ever reopening after that.
    """

    transport_id: str
    room_name: str
    room: rtc.Room = field(default_factory=rtc.Room)
    _writers: dict[str, wave.Wave_write] = field(default_factory=dict)
    _finalized: set[str] = field(default_factory=set)
    _streams: list[asyncio.Task] = field(default_factory=list)
    _asr_sessions: dict[str, ASRSession] = field(default_factory=dict)
    _speakers: dict[str, str] = field(default_factory=dict)
    _elapsed_s: dict[str, float] = field(default_factory=dict)
    """Total seconds of audio fed to this identity's ASR session so far."""
    _cursor_s: dict[str, float] = field(default_factory=dict)
    """End of the last finalized transcript segment — segment boundaries
    are approximate (Cartesia doesn't tie text back to exact audio spans),
    but this keeps them monotonic and non-overlapping."""

    async def start(self) -> None:
        token = (
            api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
            .with_identity(f"relay-recorder-{self.transport_id}")
            .with_name("Relay Capture")
            .with_grants(
                api.VideoGrants(
                    room_join=True,
                    room=self.room_name,
                    can_publish=False,
                    can_subscribe=True,
                )
            )
            .to_jwt()
        )

        self.room.on("track_subscribed", self._on_track_subscribed)

        await self.room.connect(settings.livekit_url, token)
        logger.info("capture: joined room %s for transport %s", self.room_name, self.transport_id)

    def _on_track_subscribed(
        self,
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return
        logger.info(
            "capture: subscribed to audio track sid=%s from %s (transport %s)",
            publication.sid,
            participant.identity,
            self.transport_id,
        )
        self._speakers[participant.identity] = _parse_speaker(participant.metadata)
        task = asyncio.create_task(self._consume_audio(track, participant.identity))
        self._streams.append(task)

    async def _consume_audio(self, track: rtc.Track, identity: str) -> None:
        stream = rtc.AudioStream.from_track(track=track, sample_rate=48000, num_channels=1)
        try:
            async for event in stream:
                await self._handle_frame(identity, event.frame)
        finally:
            await stream.aclose()
            await self._finalize(identity)

    async def _handle_frame(self, identity: str, frame: rtc.AudioFrame) -> None:
        """Write one frame for `identity` and forward it to that identity's
        ASR session. Both are opened lazily on first use. A frame arriving
        after `identity` was finalized is dropped rather than reopening
        (and truncating) the file — see class docstring."""
        if identity in self._finalized:
            return
        writer = self._writers.get(identity)
        if writer is None:
            writer = _open_writer(self.transport_id, identity, frame.sample_rate, frame.num_channels)
            self._writers[identity] = writer
        writer.writeframes(bytes(frame.data))

        asr = self._asr_sessions.get(identity)
        if asr is None:
            asr = create_asr_session(
                sample_rate=frame.sample_rate,
                num_channels=frame.num_channels,
                on_transcript=lambda chunk, identity=identity: self._on_transcript(identity, chunk),
            )
            self._asr_sessions[identity] = asr
            self._elapsed_s[identity] = 0.0
            self._cursor_s[identity] = 0.0
        await asr.send_audio(bytes(frame.data))
        self._elapsed_s[identity] += frame.samples_per_channel / frame.sample_rate

    async def _on_transcript(self, identity: str, chunk: TranscriptChunk) -> None:
        if not chunk.is_final:
            return
        t_start = self._cursor_s.get(identity, 0.0)
        t_end = t_start + chunk.duration_s if chunk.duration_s is not None else self._elapsed_s.get(identity, t_start)
        t_end = max(t_end, t_start)
        self._cursor_s[identity] = t_end

        await transcript_store.insert_segment(
            transport_id=self.transport_id,
            speaker=self._speakers.get(identity, "unknown"),
            text=chunk.text,
            original_text=chunk.text,
            language="en",
            confidence=chunk.confidence,
            t_start=t_start,
            t_end=t_end,
        )
        await report_generator.request_regeneration(self.transport_id)

    async def _finalize(self, identity: str) -> None:
        self._finalized.add(identity)
        writer = self._writers.pop(identity, None)
        if writer:
            writer.close()
            logger.info(
                "capture: closed recording for %s (transport %s)",
                identity,
                self.transport_id,
            )
        asr = self._asr_sessions.pop(identity, None)
        if asr:
            await asr.close()

    async def stop(self) -> None:
        for task in self._streams:
            task.cancel()
        for identity in list(self._writers.keys() | self._asr_sessions.keys()):
            await self._finalize(identity)
        await self.room.disconnect()
        logger.info("capture: stopped for transport %s", self.transport_id)


def _open_writer(transport_id: str, identity: str, sample_rate: int, num_channels: int) -> wave.Wave_write:
    if settings.audio_storage_backend != "local":
        raise NotImplementedError(
            f"AUDIO_STORAGE_BACKEND={settings.audio_storage_backend!r} not implemented yet — "
            "only 'local' is wired up in phase 2."
        )
    directory = os.path.join(settings.audio_storage_dir, transport_id)
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f"{identity}.wav")
    writer = wave.open(path, "wb")
    writer.setnchannels(num_channels)
    writer.setsampwidth(2)  # 16-bit PCM
    writer.setframerate(sample_rate)
    logger.info("capture: writing %s", path)
    return writer


def _parse_speaker(metadata: str) -> str:
    try:
        parsed = json.loads(metadata) if metadata else {}
        speaker = parsed.get("speaker")
    except (json.JSONDecodeError, AttributeError):
        speaker = None
    return speaker if speaker in VALID_SPEAKERS else "unknown"


_active_recorders: dict[str, RoomRecorder] = {}


async def start_capture(transport_id: str, room_name: str) -> None:
    if transport_id in _active_recorders:
        logger.warning("capture: already recording transport %s", transport_id)
        return
    recorder = RoomRecorder(transport_id=transport_id, room_name=room_name)
    _active_recorders[transport_id] = recorder
    await recorder.start()


async def stop_capture(transport_id: str) -> None:
    recorder = _active_recorders.pop(transport_id, None)
    if recorder is None:
        return
    await recorder.stop()
