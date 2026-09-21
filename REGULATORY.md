# Regulatory posture

Relay generates clinical decision support content — triage acuity scores, protocol
match alerts, medication reference lookups, predicted resource needs — from a live
transcript of an ambulance-to-hospital handoff. Software of this shape is likely to
fall under **FDA regulation as Software as a Medical Device (SaMD)** in the United
States, most plausibly under the Clinical Decision Support (CDS) provisions of the
21st Century Cures Act (Section 3060) and the FDA's associated CDS guidance, since
it processes patient-specific clinical information and surfaces recommendations
that could influence a clinical decision.

This is not a legal determination. It is a flag: before any pilot goes live with
real patients, get a qualified regulatory consultant to assess whether Relay's
specific feature set requires a 510(k) submission, qualifies for a CDS exemption,
or needs some other pathway. Do not treat this document as that assessment.

## How the pilot build stays on the safer side of that line

The architecture and product rules in this repo are deliberately shaped to keep
Relay closer to informational/reference software than to autonomous CDS, per the
non-negotiable rules in the product spec:

- **No autonomous action.** The AI never administers, orders, or confirms
  anything. Every output is a surfaced suggestion; a human clinician acts.
- **Reference-lookup framing only.** Dosage suggestions render as a named,
  linked protocol citation ("Regional protocol 4.2 lists 0.3mg IM for this
  weight band"), never as a bare imperative ("Give 0.3mg"). This is the
  difference between a drug reference lookup and a treatment order.
- **Traceability by construction.** Every clinical claim in a report links back
  to the transcript span that produced it (`report_claims.source_segment_ids`).
  Nothing ships as an unsourced assertion.
- **Confidence-gated alerting.** Low-confidence ASR spans are visually
  distinguished and excluded from triggering any alert path. A misheard phrase
  cannot silently become a clinical fact.
- **One-tap human override, everywhere.** A medic can reject any AI-produced
  item; the rejection persists to the hospital view (`report_claims.human_override`).
- **Explicit unverified state.** Every report is marked `UNVERIFIED — EN ROUTE`
  until a human signs it (`reports.signed_by`, `reports.signed_at`).
- **Full audit trail.** Every model output, human override, and alert fire is
  timestamped in `audit_log`, so the system's behavior is reconstructable after
  the fact.

## Before expanding scope

If a future version moves toward more autonomous suggestions (e.g. auto-filling
a specific dose rather than citing a protocol range, or auto-paging a team
without human review), revisit this document — that is very likely to cross
from "reference tool" into territory that needs a formal regulatory pathway
before shipping to a live clinical environment.
