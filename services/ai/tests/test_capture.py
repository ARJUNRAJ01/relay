"""Regression test for the writer-reopen bug: a frame arriving after a
participant's recording was finalized used to reopen (and truncate) the WAV
file instead of being dropped. See RoomRecorder's docstring in app/capture.py.

Also covers the phase 3 ASR wiring using a FakeASRSession, so these tests
never touch the network or a real Cartesia key.
"""

from dataclasses import dataclass, field

from app import capture


@dataclass
class FakeFrame:
    data: bytes
    sample_rate: int = 48000
    num_channels: int = 1
    samples_per_channel: int = 10


class FakeASRSession:
    def __init__(self, **kwargs):
        self.sent: list[bytes] = []
        self.closed = False

    async def send_audio(self, pcm16_bytes: bytes) -> None:
        self.sent.append(pcm16_bytes)

    async def close(self) -> None:
        self.closed = True


def make_recorder(tmp_path, monkeypatch):
    monkeypatch.setattr(capture.settings, "audio_storage_backend", "local")
    monkeypatch.setattr(capture.settings, "audio_storage_dir", str(tmp_path))
    monkeypatch.setattr(capture, "create_asr_session", lambda **kwargs: FakeASRSession(**kwargs))

    async def fake_insert_segment(**kwargs):
        return None

    async def fake_request_regeneration(transport_id):
        return None

    monkeypatch.setattr(capture.transcript_store, "insert_segment", fake_insert_segment)
    monkeypatch.setattr(capture.report_generator, "request_regeneration", fake_request_regeneration)
    return capture.RoomRecorder(transport_id="tx-1", room_name="room-1")


async def test_handle_frame_opens_writer_and_writes(tmp_path, monkeypatch):
    recorder = make_recorder(tmp_path, monkeypatch)
    await recorder._handle_frame("medic", FakeFrame(data=b"\x00\x01" * 10))

    assert "medic" in recorder._writers
    assert "medic" in recorder._asr_sessions
    path = tmp_path / "tx-1" / "medic.wav"
    assert path.exists()


async def test_finalize_then_frame_is_dropped_not_reopened(tmp_path, monkeypatch):
    """This is the exact bug: without the `_finalized` guard, a frame
    arriving after finalize() re-opened the file in 'wb' mode, truncating
    whatever had already been written."""
    recorder = make_recorder(tmp_path, monkeypatch)
    await recorder._handle_frame("medic", FakeFrame(data=b"\x00\x01" * 100))

    path = tmp_path / "tx-1" / "medic.wav"
    await recorder._finalize("medic")
    size_after_finalize = path.stat().st_size

    # A late frame (e.g. from a duplicate subscribe/consume task) must be a
    # no-op: no reopen, no truncation, no exception.
    await recorder._handle_frame("medic", FakeFrame(data=b"\xff\xff" * 100))

    assert "medic" not in recorder._writers
    assert path.stat().st_size == size_after_finalize


async def test_finalize_is_idempotent(tmp_path, monkeypatch):
    recorder = make_recorder(tmp_path, monkeypatch)
    await recorder._handle_frame("medic", FakeFrame(data=b"\x00\x01"))

    await recorder._finalize("medic")
    await recorder._finalize("medic")  # must not raise (e.g. double-close)


async def test_stop_finalizes_all_open_writers_and_asr_sessions(tmp_path, monkeypatch):
    recorder = make_recorder(tmp_path, monkeypatch)
    await recorder._handle_frame("medic", FakeFrame(data=b"\x00\x01"))
    await recorder._handle_frame("bystander", FakeFrame(data=b"\x02\x03"))
    medic_asr = recorder._asr_sessions["medic"]
    bystander_asr = recorder._asr_sessions["bystander"]

    async def fake_disconnect():
        return None

    monkeypatch.setattr(recorder.room, "disconnect", fake_disconnect)

    await recorder.stop()

    assert recorder._writers == {}
    assert recorder._asr_sessions == {}
    assert recorder._finalized == {"medic", "bystander"}
    assert medic_asr.closed and bystander_asr.closed


async def test_on_transcript_ignores_partials(tmp_path, monkeypatch):
    from app.asr.base import TranscriptChunk

    recorder = make_recorder(tmp_path, monkeypatch)
    calls = []

    async def fake_insert_segment(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(capture.transcript_store, "insert_segment", fake_insert_segment)

    await recorder._on_transcript("medic", TranscriptChunk(text="hel", is_final=False, duration_s=None, confidence=1.0))
    assert calls == []

    await recorder._on_transcript(
        "medic", TranscriptChunk(text="hello", is_final=True, duration_s=1.5, confidence=1.0)
    )
    assert len(calls) == 1
    assert calls[0]["t_start"] == 0.0
    assert calls[0]["t_end"] == 1.5


def test_parse_speaker_valid_and_invalid():
    assert capture._parse_speaker('{"speaker": "medic"}') == "medic"
    assert capture._parse_speaker('{"speaker": "alien"}') == "unknown"
    assert capture._parse_speaker("") == "unknown"
    assert capture._parse_speaker("not json") == "unknown"
