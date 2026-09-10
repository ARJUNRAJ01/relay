"""Covers the timeline-stitching math: reconciled segments must start at
gap_start_s and stay monotonic, so audio recorded offline slots correctly
between the live segments before and after the gap."""

from app import reconcile
from app.asr.base import TranscriptChunk


class FakeASRSession:
    def __init__(self, chunks_to_emit, **kwargs):
        self._on_transcript = kwargs["on_transcript"]
        self._chunks_to_emit = chunks_to_emit
        self.sent_bytes = b""
        self.closed = False

    async def send_audio(self, pcm16_bytes: bytes) -> None:
        self.sent_bytes += pcm16_bytes

    async def close(self) -> None:
        self.closed = True
        for chunk in self._chunks_to_emit:
            await self._on_transcript(chunk)


def make_recorder_factory(chunks_to_emit):
    def factory(**kwargs):
        return FakeASRSession(chunks_to_emit, **kwargs)

    return factory


async def test_reconciled_segments_start_at_gap_start_and_stay_monotonic(monkeypatch, tmp_path):
    monkeypatch.setattr(reconcile, "_decode_to_pcm16", _fake_decode(b"\x00\x01" * 4800))
    monkeypatch.setattr(reconcile.settings, "audio_storage_backend", "local")
    monkeypatch.setattr(reconcile.settings, "audio_storage_dir", str(tmp_path))

    chunks = [
        TranscriptChunk(text="first", is_final=True, duration_s=2.0, confidence=1.0),
        TranscriptChunk(text="second", is_final=True, duration_s=1.5, confidence=1.0),
    ]
    monkeypatch.setattr(reconcile, "create_asr_session", make_recorder_factory(chunks))

    inserted = []

    async def fake_insert_segment(**kwargs):
        inserted.append(kwargs)

    regenerated = []

    async def fake_request_regeneration(transport_id):
        regenerated.append(transport_id)

    monkeypatch.setattr(reconcile.transcript_store, "insert_segment", fake_insert_segment)
    monkeypatch.setattr(reconcile.report_generator, "request_regeneration", fake_request_regeneration)

    await reconcile.reconcile_audio(
        transport_id="tx-1",
        identity="medic-1",
        speaker="medic",
        webm_bytes=b"fake-webm",
        gap_start_s=10.0,
    )

    assert len(inserted) == 2
    assert inserted[0]["t_start"] == 10.0
    assert inserted[0]["t_end"] == 12.0
    assert inserted[1]["t_start"] == 12.0
    assert inserted[1]["t_end"] == 13.5
    assert all(s["transport_id"] == "tx-1" and s["speaker"] == "medic" for s in inserted)
    assert regenerated == ["tx-1"]

    wav_path = tmp_path / "tx-1" / "medic-1-reconciled-10.0.wav"
    assert wav_path.exists()


async def test_no_transcript_chunks_skips_report_regeneration(monkeypatch, tmp_path):
    monkeypatch.setattr(reconcile, "_decode_to_pcm16", _fake_decode(b"\x00\x01" * 100))
    monkeypatch.setattr(reconcile.settings, "audio_storage_backend", "local")
    monkeypatch.setattr(reconcile.settings, "audio_storage_dir", str(tmp_path))
    monkeypatch.setattr(reconcile, "create_asr_session", make_recorder_factory([]))

    regenerated = []

    async def fake_request_regeneration(transport_id):
        regenerated.append(transport_id)

    monkeypatch.setattr(reconcile.report_generator, "request_regeneration", fake_request_regeneration)

    await reconcile.reconcile_audio(
        transport_id="tx-1", identity="medic-1", speaker="medic", webm_bytes=b"x", gap_start_s=0.0
    )

    assert regenerated == []


async def test_empty_decode_is_a_noop(monkeypatch):
    monkeypatch.setattr(reconcile, "_decode_to_pcm16", _fake_decode(b""))

    called = {"asr": False}
    monkeypatch.setattr(reconcile, "create_asr_session", lambda **kw: called.__setitem__("asr", True))

    await reconcile.reconcile_audio(
        transport_id="tx-1", identity="medic-1", speaker="medic", webm_bytes=b"x", gap_start_s=0.0
    )

    assert called["asr"] is False


def _fake_decode(pcm_bytes: bytes):
    async def _decode(webm_bytes: bytes) -> bytes:
        return pcm_bytes

    return _decode
