"""Covers the traceability guarantee: every stored claim must resolve to
real transcript_segments ids, and a claim the model couldn't source to any
segment index is dropped rather than stored as if it were sourced."""

from app import report_generator


class FakeLLM:
    def __init__(self, response: dict):
        self.response = response
        self.calls = []

    async def complete_json(self, *, system_prompt, user_prompt):
        self.calls.append((system_prompt, user_prompt))
        return self.response


def make_segments(n: int) -> list[dict]:
    return [
        {"id": f"seg-{i}", "speaker": "medic", "text": f"text {i}", "t_start": float(i), "t_end": float(i + 1)}
        for i in range(n)
    ]


async def test_generate_skips_when_no_segments(monkeypatch):
    async def fake_list_segments(transport_id):
        return []

    monkeypatch.setattr(report_generator.transcript_store, "list_segments", fake_list_segments)

    inserted = {"called": False}

    async def fake_insert_report(**kwargs):
        inserted["called"] = True
        return "report-1"

    monkeypatch.setattr(report_generator.report_store, "insert_report", fake_insert_report)

    await report_generator._generate("tx-1")
    assert inserted["called"] is False


async def test_generate_maps_indices_and_drops_unsourced_claims(monkeypatch):
    segments = make_segments(3)

    async def fake_list_segments(transport_id):
        return segments

    monkeypatch.setattr(report_generator.transcript_store, "list_segments", fake_list_segments)

    llm_response = {
        "chief_complaint": "chest pain",
        "claims": [
            {
                "field": "chief_complaint",
                "value": "chest pain",
                "source_segment_indices": [0, 1],
                "confidence": 0.9,
            },
            {
                # No source_segment_indices at all — must be dropped.
                "field": "triage_acuity",
                "value": {"score": 2, "reasoning": "stable"},
                "confidence": 0.6,
            },
            {
                # Out-of-range index — must be dropped (defensive against a
                # hallucinated index the model made up).
                "field": "vitals[0]",
                "value": "hr 90",
                "source_segment_indices": [99],
                "confidence": 0.8,
            },
        ],
    }
    monkeypatch.setattr(report_generator, "get_llm_provider", lambda: FakeLLM(llm_response))

    async def fake_next_version(transport_id):
        return 1

    captured_report = {}

    async def fake_insert_report(**kwargs):
        captured_report.update(kwargs)
        return "report-1"

    captured_claims = []

    async def fake_insert_claims(claims):
        captured_claims.extend(claims)

    monkeypatch.setattr(report_generator.report_store, "next_version", fake_next_version)
    monkeypatch.setattr(report_generator.report_store, "insert_report", fake_insert_report)
    monkeypatch.setattr(report_generator.report_store, "insert_claims", fake_insert_claims)

    await report_generator._generate("tx-1")

    assert captured_report["transport_id"] == "tx-1"
    assert captured_report["version"] == 1
    assert "claims" not in captured_report["soap"]  # popped before storing as the report body

    assert len(captured_claims) == 1
    assert captured_claims[0]["field"] == "chief_complaint"
    assert captured_claims[0]["source_segment_ids"] == ["seg-0", "seg-1"]
    assert captured_claims[0]["report_id"] == "report-1"


async def test_generate_clamps_out_of_range_confidence(monkeypatch):
    segments = make_segments(1)

    async def fake_list_segments(transport_id):
        return segments

    monkeypatch.setattr(report_generator.transcript_store, "list_segments", fake_list_segments)
    monkeypatch.setattr(
        report_generator,
        "get_llm_provider",
        lambda: FakeLLM(
            {
                "claims": [
                    {"field": "x", "value": 1, "source_segment_indices": [0], "confidence": 5.0},
                ]
            }
        ),
    )

    async def fake_next_version(transport_id):
        return 1

    async def fake_insert_report(**kwargs):
        return "report-1"

    captured_claims = []

    async def fake_insert_claims(claims):
        captured_claims.extend(claims)

    monkeypatch.setattr(report_generator.report_store, "next_version", fake_next_version)
    monkeypatch.setattr(report_generator.report_store, "insert_report", fake_insert_report)
    monkeypatch.setattr(report_generator.report_store, "insert_claims", fake_insert_claims)

    await report_generator._generate("tx-1")

    assert captured_claims[0]["confidence"] == 1.0
