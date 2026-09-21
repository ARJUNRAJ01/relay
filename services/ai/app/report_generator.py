"""Turns the rolling transcript into a live-updating SOAP report.

Safety framing (see REGULATORY.md and the product spec's non-negotiable
rules): the model only documents what was actually said — administered
medications, reported vitals, stated procedures. It never proposes a
medication, dose, or treatment that wasn't already stated as given or
decided by the medic. The one genuinely predictive output, triage acuity,
ships with its reasoning attached and is explicitly framed in the UI as an
AI-suggested assessment for a human to confirm, never an instruction.

Every field the model produces is required to come with a `claims` entry
citing which transcript segments support it. That traceability is the
actual trust mechanism the product depends on — a claim with no
`source_segment_indices` is dropped, not stored as if it were sourced.

Known gap, flagged not hidden: the `confidence` on each claim is the
model's own self-assessment of how directly the transcript supports that
specific field. LLM self-reported confidence is well known to be poorly
calibrated — treat this the same way as the ASR placeholder confidence in
app/asr/cartesia.py: fine for display, not yet a number alert-gating logic
should trust without further work.

`protocol_matches` (STEMI / stroke / sepsis / major trauma) feeds phase 5's
protocol-match alert — see app/alerts.py, which also derives deterioration
and contraindication alerts from this same extraction rather than a
separate LLM call.
"""

import asyncio
import logging

from app import alerts, report_store, transcript_store
from app.llm.base import get_llm_provider

logger = logging.getLogger("relay.report_generator")

SYSTEM_PROMPT = """You are a clinical documentation assistant for EMS-to-hospital handoff. \
You read a timestamped transcript of an ambulance crew's radio/voice report and extract a \
structured summary of what was ACTUALLY SAID. You are a stenographer, not a clinician: you do \
not infer facts that weren't stated, and you never suggest a medication, dose, route, or \
treatment that the medic did not already report as given or decided. The one exception is \
triage_acuity, which is your own clinical judgment call — for that one field only, explain your \
reasoning so a human can evaluate it; do not present it as fact.

Every field you output must also appear in a `claims` entry that cites the exact transcript \
segment indices (the numbers in brackets, e.g. "[3]") that support it. If you cannot point to a \
specific segment for a fact, do not include that fact at all — omission is always safer than an \
unsourced claim.

Return ONLY a JSON object with this exact shape (omit a field entirely if the transcript gives \
no basis for it, rather than guessing):

{
  "chief_complaint": "string or null",
  "soap": {
    "subjective": "what the patient/bystanders reported, in their own terms",
    "objective": "exam findings and vitals as stated",
    "assessment": "the medic's own stated clinical impression, if any",
    "plan": "the medic's own stated treatment/transport plan, if any"
  },
  "vitals": [ { "type": "bp|hr|rr|spo2|temp|gcs", "value": "string as reported", "time_s": number or null } ],
  "medications": [ { "name": "string", "dose": "string", "route": "string", "time_s": number or null } ],
  "procedures": [ { "name": "string", "time_s": number or null } ],
  "allergies": [ "string" ],
  "predicted_resources": [ "string, e.g. 'Trauma bay', 'Cardiology on call', 'CT'" ],
  "triage_acuity": { "score": 1-5, "reasoning": "string" },
  "protocol_matches": [
    {
      "protocol": "stemi|stroke|sepsis|major_trauma",
      "reasoning": "string — the specific findings that suggest this",
      "source_segment_indices": [int, ...]
    }
  ],
  "claims": [
    {
      "field": "dotted path, e.g. 'chief_complaint', 'soap.subjective', 'vitals[0]', 'medications[0]', 'triage_acuity'",
      "value": <the same value stored at that field>,
      "source_segment_indices": [int, ...],
      "confidence": 0.0-1.0
    }
  ]
}
"""

_locks: dict[str, asyncio.Lock] = {}
_pending: set[str] = set()


async def request_regeneration(transport_id: str) -> None:
    """Fire-and-forget trigger, called after each finalized transcript
    segment. Coalesces bursts: if a generation is already running for this
    transport, this just marks one more pending run instead of queuing an
    unbounded pile of overlapping LLM calls."""
    lock = _locks.setdefault(transport_id, asyncio.Lock())
    if lock.locked():
        _pending.add(transport_id)
        return
    asyncio.create_task(_run(transport_id))


async def _run(transport_id: str) -> None:
    lock = _locks[transport_id]
    async with lock:
        try:
            await _generate(transport_id)
        except Exception:
            logger.exception("report generation failed for transport %s", transport_id)

    if transport_id in _pending:
        _pending.discard(transport_id)
        asyncio.create_task(_run(transport_id))


async def _generate(transport_id: str) -> None:
    segments = await transcript_store.list_segments(transport_id)
    if not segments:
        return

    transcript_text = "\n".join(
        f"[{i}] ({s['speaker']}, t={s['t_start']:.1f}-{s['t_end']:.1f}s): {s['text']}"
        for i, s in enumerate(segments)
    )

    llm = get_llm_provider()
    try:
        extracted = await llm.complete_json(system_prompt=SYSTEM_PROMPT, user_prompt=transcript_text)
    except Exception:
        logger.exception("LLM call failed for transport %s", transport_id)
        return

    claims_raw = extracted.pop("claims", [])
    previous = await report_store.get_latest(transport_id)
    version = (previous["version"] + 1) if previous else 1
    fhir_payload = _build_fhir_bundle(extracted)
    report_id = await report_store.insert_report(
        transport_id=transport_id, version=version, soap=extracted, fhir_payload=fhir_payload
    )

    claims = []
    for claim in claims_raw:
        indices = claim.get("source_segment_indices") or []
        segment_ids = [segments[i]["id"] for i in indices if isinstance(i, int) and 0 <= i < len(segments)]
        if not segment_ids:
            continue  # unsourced claim — dropped, not stored (see module docstring)
        claims.append(
            {
                "report_id": report_id,
                "field": claim.get("field", "unknown"),
                "value": claim.get("value"),
                "source_segment_ids": segment_ids,
                "confidence": max(0.0, min(1.0, float(claim.get("confidence", 0.5)))),
            }
        )
    await report_store.insert_claims(claims)
    logger.info("report v%d generated for transport %s (%d claims)", version, transport_id, len(claims))

    triage_score = (extracted.get("triage_acuity") or {}).get("score")
    if isinstance(triage_score, int) and 1 <= triage_score <= 5:
        await report_store.update_transport_acuity(transport_id, triage_score)

    try:
        await alerts.evaluate_and_fire(
            transport_id=transport_id,
            segments=segments,
            current=extracted,
            previous=previous["soap"] if previous else None,
        )
    except Exception:
        logger.exception("alert evaluation failed for transport %s", transport_id)


def _build_fhir_bundle(extracted: dict) -> dict:
    """Minimal FHIR-*shaped* bundle — not validated against the full spec,
    just structured enough to be a starting point for a real EHR integration
    later (see the Epic/Cerner env vars in the "Later, not for the pilot"
    section of the spec)."""
    entries = []

    if extracted.get("chief_complaint"):
        entries.append(
            {
                "resource": {
                    "resourceType": "Condition",
                    "code": {"text": extracted["chief_complaint"]},
                }
            }
        )

    for vital in extracted.get("vitals", []):
        entries.append(
            {
                "resource": {
                    "resourceType": "Observation",
                    "code": {"text": vital.get("type")},
                    "valueString": vital.get("value"),
                }
            }
        )

    for med in extracted.get("medications", []):
        entries.append(
            {
                "resource": {
                    "resourceType": "MedicationAdministration",
                    "medicationCodeableConcept": {"text": med.get("name")},
                    "dosage": {"text": f"{med.get('dose', '')} {med.get('route', '')}".strip()},
                }
            }
        )

    for proc in extracted.get("procedures", []):
        entries.append(
            {"resource": {"resourceType": "Procedure", "code": {"text": proc.get("name")}}}
        )

    return {"resourceType": "Bundle", "type": "collection", "entry": entries}
