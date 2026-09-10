"""Regression test for the writer-reopen bug: a frame arriving after a
participant's recording was finalized used to reopen (and truncate) the WAV
file instead of being dropped. See RoomRecorder's docstring in app/capture.py.
"""

from dataclasses import dataclass
from types import SimpleNamespace

import pytest

from app import capture


@dataclass
class FakeFrame:
    data: bytes
    sample_rate: int = 48000
    num_channels: int = 1


def make_recorder(tmp_path, monkeypatch):
    monkeypatch.setattr(capture.settings, "audio_storage_backend", "local")
    monkeypatch.setattr(capture.settings, "audio_storage_dir", str(tmp_path))
    return capture.RoomRecorder(transport_id="tx-1", room_name="room-1")


def test_handle_frame_opens_writer_and_writes(tmp_path, monkeypatch):
    recorder = make_recorder(tmp_path, monkeypatch)
    recorder._handle_frame("medic", FakeFrame(data=b"\x00\x01" * 10))

    assert "medic" in recorder._writers
    path = tmp_path / "tx-1" / "medic.wav"
    assert path.exists()


def test_finalize_then_frame_is_dropped_not_reopened(tmp_path, monkeypatch):
    """This is the exact bug: without the `_finalized` guard, a frame
    arriving after finalize() re-opened the file in 'wb' mode, truncating
    whatever had already been written."""
    recorder = make_recorder(tmp_path, monkeypatch)
    recorder._handle_frame("medic", FakeFrame(data=b"\x00\x01" * 100))

    path = tmp_path / "tx-1" / "medic.wav"
    recorder._finalize("medic")
    size_after_finalize = path.stat().st_size

    # A late frame (e.g. from a duplicate subscribe/consume task) must be a
    # no-op: no reopen, no truncation, no exception.
    recorder._handle_frame("medic", FakeFrame(data=b"\xff\xff" * 100))

    assert "medic" not in recorder._writers
    assert path.stat().st_size == size_after_finalize


def test_finalize_is_idempotent(tmp_path, monkeypatch):
    recorder = make_recorder(tmp_path, monkeypatch)
    recorder._handle_frame("medic", FakeFrame(data=b"\x00\x01"))

    recorder._finalize("medic")
    recorder._finalize("medic")  # must not raise (e.g. double-close)


@pytest.mark.asyncio
async def test_stop_finalizes_all_open_writers(tmp_path, monkeypatch):
    recorder = make_recorder(tmp_path, monkeypatch)
    recorder._handle_frame("medic", FakeFrame(data=b"\x00\x01"))
    recorder._handle_frame("bystander", FakeFrame(data=b"\x02\x03"))

    async def fake_disconnect():
        return None

    monkeypatch.setattr(recorder.room, "disconnect", fake_disconnect)

    await recorder.stop()

    assert recorder._writers == {}
    assert recorder._finalized == {"medic", "bystander"}
