"""Covers the three alert paths and the one non-negotiable rule tying them
together: a low-confidence transcript span must never trigger an alert."""

from app import alerts


def make_segments(confidences: list[float]) -> list[dict]:
    return [{"id": f"seg-{i}", "confidence": c} for i, c in enumerate(confidences)]


def make_capture(monkeypatch):
    fired = []

    async def fake_insert_alert(**kwargs):
        fired.append(kwargs)

    async def fake_get_paging_target(transport_id):
        return "+15551234567", "MEDIC-7"

    paged = []

    async def fake_send_page(to, message):
        paged.append((to, message))

    monkeypatch.setattr(alerts.alert_store, "insert_alert", fake_insert_alert)
    monkeypatch.setattr(alerts.alert_store, "get_paging_target", fake_get_paging_target)
    monkeypatch.setattr(alerts.paging, "send_page", fake_send_page)
    return fired, paged


async def test_protocol_match_fires_and_pages(monkeypatch):
    fired, paged = make_capture(monkeypatch)
    segments = make_segments([1.0, 1.0])
    current = {
        "protocol_matches": [
            {"protocol": "stemi", "reasoning": "chest pain + high HR", "source_segment_indices": [0, 1]}
        ]
    }

    await alerts.evaluate_and_fire(transport_id="tx-1", segments=segments, current=current, previous=None)

    assert len(fired) == 1
    assert fired[0]["kind"] == "protocol_match"
    assert fired[0]["payload"]["protocol"] == "stemi"
    assert len(paged) == 1
    assert "STEMI" in paged[0][1]


async def test_protocol_match_blocked_by_low_confidence_segment(monkeypatch):
    """The exact rule from the product spec: a low-confidence ASR span must
    never become the basis for an alert."""
    fired, paged = make_capture(monkeypatch)
    segments = make_segments([1.0, 0.2])  # second segment below threshold
    current = {
        "protocol_matches": [
            {"protocol": "stroke", "reasoning": "slurred speech", "source_segment_indices": [0, 1]}
        ]
    }

    await alerts.evaluate_and_fire(transport_id="tx-1", segments=segments, current=current, previous=None)

    assert fired == []
    assert paged == []


async def test_protocol_match_ignores_unknown_protocol_name(monkeypatch):
    fired, _ = make_capture(monkeypatch)
    segments = make_segments([1.0])
    current = {"protocol_matches": [{"protocol": "flu", "source_segment_indices": [0]}]}

    await alerts.evaluate_and_fire(transport_id="tx-1", segments=segments, current=current, previous=None)

    assert fired == []


async def test_deterioration_fires_on_large_hr_delta(monkeypatch):
    fired, _ = make_capture(monkeypatch)
    previous = {"vitals": [{"type": "hr", "value": "80"}]}
    current = {"vitals": [{"type": "hr", "value": "125"}]}  # +45, over the 20bpm threshold

    await alerts.evaluate_and_fire(transport_id="tx-1", segments=[], current=current, previous=previous)

    assert len(fired) == 1
    assert fired[0]["kind"] == "deterioration"
    assert fired[0]["payload"]["vital"] == "hr"


async def test_deterioration_fires_on_absolute_low_spo2_even_without_previous(monkeypatch):
    fired, _ = make_capture(monkeypatch)
    current = {"vitals": [{"type": "spo2", "value": "85%"}]}

    await alerts.evaluate_and_fire(transport_id="tx-1", segments=[], current=current, previous={"vitals": []})

    assert len(fired) == 1
    assert fired[0]["payload"]["vital"] == "spo2"


async def test_deterioration_does_not_fire_on_stable_vitals(monkeypatch):
    fired, _ = make_capture(monkeypatch)
    previous = {"vitals": [{"type": "hr", "value": "80"}, {"type": "bp", "value": "120/80"}]}
    current = {"vitals": [{"type": "hr", "value": "85"}, {"type": "bp", "value": "118/78"}]}

    await alerts.evaluate_and_fire(transport_id="tx-1", segments=[], current=current, previous=previous)

    assert fired == []


async def test_deterioration_skipped_with_no_previous_report(monkeypatch):
    fired, _ = make_capture(monkeypatch)
    current = {"vitals": [{"type": "hr", "value": "85"}]}

    await alerts.evaluate_and_fire(transport_id="tx-1", segments=[], current=current, previous=None)

    assert fired == []


async def test_contraindication_fires_on_matching_allergy(monkeypatch):
    fired, paged = make_capture(monkeypatch)
    current = {
        "medications": [{"name": "Aspirin", "dose": "325mg", "route": "PO"}],
        "allergies": ["aspirin"],
    }

    await alerts.evaluate_and_fire(transport_id="tx-1", segments=[], current=current, previous=None)

    assert len(fired) == 1
    assert fired[0]["kind"] == "contraindication"
    assert "aspirin" in fired[0]["payload"]["allergy"]
    assert len(paged) == 1


async def test_contraindication_does_not_fire_for_unrelated_medication(monkeypatch):
    fired, _ = make_capture(monkeypatch)
    current = {
        "medications": [{"name": "Albuterol"}],
        "allergies": ["penicillin"],
    }

    await alerts.evaluate_and_fire(transport_id="tx-1", segments=[], current=current, previous=None)

    assert fired == []


async def test_no_paging_target_does_not_crash(monkeypatch):
    async def fake_insert_alert(**kwargs):
        pass

    async def fake_get_paging_target(transport_id):
        return None, None

    paged = []

    async def fake_send_page(to, message):
        paged.append((to, message))

    monkeypatch.setattr(alerts.alert_store, "insert_alert", fake_insert_alert)
    monkeypatch.setattr(alerts.alert_store, "get_paging_target", fake_get_paging_target)
    monkeypatch.setattr(alerts.paging, "send_page", fake_send_page)

    current = {"protocol_matches": [{"protocol": "sepsis", "source_segment_indices": [0]}]}
    await alerts.evaluate_and_fire(
        transport_id="tx-1", segments=make_segments([1.0]), current=current, previous=None
    )

    assert paged == [(None, "[Relay] Unit: PROTOCOL MATCH: SEPSIS — ")]
