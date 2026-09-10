"""Phase 2: audio capture. A bot participant joins the LiveKit room for a
transport, subscribes to every remote participant's microphone track, and
writes the raw PCM to a WAV file per participant. Storage is a local disk
directory for the demo (AUDIO_STORAGE_BACKEND=local); swapping to R2 later
means adding an "r2" branch to `_open_writer` without touching the capture
loop itself.
"""

import asyncio
import logging
import os
import wave
from dataclasses import dataclass, field

from livekit import api, rtc

from app.settings import settings

logger = logging.getLogger("relay.capture")


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
        task = asyncio.create_task(self._consume_audio(track, participant.identity))
        self._streams.append(task)

    async def _consume_audio(self, track: rtc.Track, identity: str) -> None:
        stream = rtc.AudioStream.from_track(track=track, sample_rate=48000, num_channels=1)
        try:
            async for event in stream:
                self._handle_frame(identity, event.frame)
        finally:
            await stream.aclose()
            self._finalize(identity)

    def _handle_frame(self, identity: str, frame: rtc.AudioFrame) -> None:
        """Write one frame for `identity`, opening its writer on first use.
        A frame arriving after that identity was finalized is dropped rather
        than reopening (and truncating) the file — see class docstring."""
        if identity in self._finalized:
            return
        writer = self._writers.get(identity)
        if writer is None:
            writer = _open_writer(self.transport_id, identity, frame.sample_rate, frame.num_channels)
            self._writers[identity] = writer
        writer.writeframes(bytes(frame.data))

    def _finalize(self, identity: str) -> None:
        self._finalized.add(identity)
        writer = self._writers.pop(identity, None)
        if writer:
            writer.close()
            logger.info(
                "capture: closed recording for %s (transport %s)",
                identity,
                self.transport_id,
            )

    async def stop(self) -> None:
        for task in self._streams:
            task.cancel()
        for identity in list(self._writers):
            self._finalize(identity)
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
