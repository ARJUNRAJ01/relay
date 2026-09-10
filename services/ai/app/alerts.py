"""Phase 5: three alert paths, all fired from the same extraction
report_generator.py already produces — no second LLM call.

- protocol_match: the model's own `protocol_matches` field (STEMI, stroke,
  sepsis, major trauma), confidence-gated against the ASR confidence of
  the segments it cites.
- deterioration: a small set of hand-written vital-sign thresholds
  comparing this report's vitals to the previous version's. This is a
  crude placeholder, not a validated clinical deterioration index (real
  ones — NEWS2, shock index — weight multiple vitals together and account
  for trend over more than two points). Flagged, not presented as
  clinically validated.
- contraindication: a plain substring match between reported medications
  and reported allergies. This will miss anything requiring real drug
  knowledge (drug classes, cross-reactivity) — a real implementation
  needs a drug/allergy ontology (e.g. RxNorm), not string matching.

Non-negotiable safety rule this module exists to enforce: a low-confidence
transcript span must never become the basis for an alert. Every alert here
carries `source_segment_ids`, and every one of those must clear
MIN_ALERT_CONFIDENCE before the alert fires — see `_segments_confident_enough`.
Right now that gate is a no-op in practice (Cartesia reports no real
confidence, see app/asr/cartesia.py — everything is 1.0), but the
mechanism is real and will start doing something the moment ASR
confidence is real.
"""

import logging
import re

from app import alert_store, paging

logger = logging.getLogger("relay.alerts")

MIN_ALERT_CONFIDENCE = 0.5
PROTOCOLS = {"stemi", "stroke", "sepsis", "major_trauma"}

# Crude, explicitly-flagged-as-crude deterioration thresholds.
_HR_HIGH = 130
_HR_LOW = 50
_HR_DELTA = 20
_SBP_LOW = 90
_SBP_DELTA = 20
_SPO2_LOW = 90
_SPO2_DELTA = 5


async def evaluate_and_fire(
    *,
    transport_id: str,
    segments: list[dict],
    current: dict,
    previous: dict | None,
) -> None:
    segment_confidence = {s["id"]: s["confidence"] for s in segments}

    for match in current.get("protocol_matches", []):
        protocol = match.get("protocol")
        if protocol not in PROTOCOLS:
            continue
        segment_ids = _resolve_segment_ids(match.get("source_segment_indices"), segments)
        if not segment_ids or not _segments_confident_enough(segment_ids, segment_confidence):
            continue
        await _fire(
            transport_id,
            "protocol_match",
            {
                "protocol": protocol,
                "reasoning": match.get("reasoning"),
                "source_segment_ids": segment_ids,
            },
            page_message=f"PROTOCOL MATCH: {protocol.upper()} — {match.get('reasoning', '')}",
        )

    for finding in _check_deterioration(current, previous):
        await _fire(transport_id, "deterioration", finding, page_message=f"DETERIORATION: {finding['summary']}")

    for finding in _check_contraindications(current):
        await _fire(
            transport_id,
            "contraindication",
            finding,
            page_message=f"CONTRAINDICATION: {finding['summary']}",
        )


async def _fire(transport_id: str, kind: str, payload: dict, *, page_message: str) -> None:
    await alert_store.insert_alert(transport_id=transport_id, kind=kind, payload=payload)
    on_call_phone, callsign = await alert_store.get_paging_target(transport_id)
    await paging.send_page(on_call_phone, f"[Relay] {callsign or 'Unit'}: {page_message}")
    logger.info("alert fired: %s for transport %s", kind, transport_id)


def _resolve_segment_ids(indices: object, segments: list[dict]) -> list[str]:
    if not isinstance(indices, list):
        return []
    return [segments[i]["id"] for i in indices if isinstance(i, int) and 0 <= i < len(segments)]


def _segments_confident_enough(segment_ids: list[str], segment_confidence: dict[str, float]) -> bool:
    return all(segment_confidence.get(sid, 0.0) >= MIN_ALERT_CONFIDENCE for sid in segment_ids)


def _parse_number(value: str) -> float | None:
    match = re.search(r"-?\d+(\.\d+)?", value or "")
    return float(match.group()) if match else None


def _parse_bp_systolic(value: str) -> float | None:
    match = re.search(r"(\d+)\s*/\s*\d+", value or "")
    return float(match.group(1)) if match else None


def _latest_vital(vitals: list[dict], vtype: str) -> str | None:
    for v in reversed(vitals or []):
        if v.get("type") == vtype:
            return v.get("value")
    return None


def _check_deterioration(current: dict, previous: dict | None) -> list[dict]:
    if not previous:
        return []
    findings = []

    cur_hr = _parse_number(_latest_vital(current.get("vitals", []), "hr") or "")
    prev_hr = _parse_number(_latest_vital(previous.get("vitals", []), "hr") or "")
    if cur_hr is not None:
        if cur_hr >= _HR_HIGH or cur_hr <= _HR_LOW:
            findings.append({"vital": "hr", "value": cur_hr, "summary": f"heart rate {cur_hr} bpm"})
        elif prev_hr is not None and abs(cur_hr - prev_hr) >= _HR_DELTA:
            findings.append(
                {"vital": "hr", "value": cur_hr, "previous": prev_hr, "summary": f"heart rate {prev_hr}→{cur_hr} bpm"}
            )

    cur_sbp = _parse_bp_systolic(_latest_vital(current.get("vitals", []), "bp") or "")
    prev_sbp = _parse_bp_systolic(_latest_vital(previous.get("vitals", []), "bp") or "")
    if cur_sbp is not None:
        if cur_sbp <= _SBP_LOW:
            findings.append({"vital": "bp", "value": cur_sbp, "summary": f"systolic BP {cur_sbp}"})
        elif prev_sbp is not None and (prev_sbp - cur_sbp) >= _SBP_DELTA:
            findings.append(
                {"vital": "bp", "value": cur_sbp, "previous": prev_sbp, "summary": f"systolic BP {prev_sbp}→{cur_sbp}"}
            )

    cur_spo2 = _parse_number(_latest_vital(current.get("vitals", []), "spo2") or "")
    prev_spo2 = _parse_number(_latest_vital(previous.get("vitals", []), "spo2") or "")
    if cur_spo2 is not None:
        if cur_spo2 <= _SPO2_LOW:
            findings.append({"vital": "spo2", "value": cur_spo2, "summary": f"SpO2 {cur_spo2}%"})
        elif prev_spo2 is not None and (prev_spo2 - cur_spo2) >= _SPO2_DELTA:
            findings.append(
                {"vital": "spo2", "value": cur_spo2, "previous": prev_spo2, "summary": f"SpO2 {prev_spo2}→{cur_spo2}%"}
            )

    return findings


def _check_contraindications(current: dict) -> list[dict]:
    allergies = [a.lower() for a in current.get("allergies", []) if a]
    if not allergies:
        return []
    findings = []
    for med in current.get("medications", []):
        name = (med.get("name") or "").lower()
        if not name:
            continue
        for allergy in allergies:
            if allergy in name or name in allergy:
                findings.append(
                    {
                        "medication": med.get("name"),
                        "allergy": allergy,
                        "summary": f"{med.get('name')} given, patient reports {allergy} allergy",
                    }
                )
    return findings
