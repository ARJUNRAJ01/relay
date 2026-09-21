# Relay

Pre-arrival clinical handoff for ambulances. Streams the ambulance-to-hospital
conversation into a structured, live-updating clinical report that lands before
the ambulance does — so the receiving team isn't starting from zero, and the
crew clears the bay faster for the next call.

See [REGULATORY.md](./REGULATORY.md) for the FDA/SaMD posture this pilot is built around.

## Status: Phase 7 — MCI mode

- [x] Monorepo layout (`apps/web`, `services/ai`, `supabase/`)
- [x] Supabase project, schema, and RLS (`supabase/migrations/`)
- [x] Auth (Supabase email OTP) with role-scoped profiles (medic / hospital_staff / dispatcher / admin)
- [x] Env validation with zod (web) and pydantic-settings (AI service)
- [x] Audio in: LiveKit room per transport, medic joins from mobile web,
      audio lands on the AI service, raw audio persists to disk — Phase 2
- [x] Transcript: Cartesia streaming STT, live transcript on the medic
      screen and the hospital screen via Supabase Realtime — Phase 3
- [x] Report: DeepSeek pipeline extracting a live SOAP note, vitals,
      medications, triage acuity, and predicted resources from the rolling
      transcript, every field traceable to its source segment(s), on the
      hospital's split SOAP/transcript view with click-to-source scroll
      linking — Phase 4
- [x] Alerts: protocol match (STEMI/stroke/sepsis/major trauma),
      deterioration, and contraindication detection, each confidence-gated
      against its source transcript spans, with paging (stubbed — see
      below) and a top-anchored acknowledgment banner capped at 3 — Phase 5
- [x] Offline: the medic app records locally (IndexedDB-backed) whenever
      LiveKit fully disconnects, and reconciles that audio into the
      timeline — decoded, transcribed, and correctly offset — the moment
      it reconnects, so a real network outage loses nothing — Phase 6
- [x] MCI mode: a medic can tag a transport as part of an incident when
      starting it; the hospital board groups those under a
      collapsed-by-default incident summary (name, unit count, most severe
      acuity), expandable to a severity-ranked list — Phase 7
- [ ] Polish / accessibility / load test — Phase 8

**Running fully local for now:** self-hosted LiveKit via Docker, audio
persisted to local disk, rather than LiveKit Cloud + R2 — to get a demoable
prototype fast without new cloud accounts. See "Local LiveKit" below and the
`AUDIO_STORAGE_BACKEND` var for how to swap to the cloud versions later — the
capture code doesn't change, only which URLs/keys it points at.

**Known gaps versus the full spec, flagged rather than hidden** (see
docstrings in `services/ai/app/asr/cartesia.py` for detail):
- Cartesia's streaming STT reports **no confidence score**. Every segment
  ships with a `confidence=1.0` placeholder. This has to be fixed — either
  by switching primary ASR to a provider that reports confidence (Deepgram
  is the documented fallback and does), or adding a proxy signal — before
  phase 5 (alerts) can safely gate on transcript confidence.
- **No true diarization.** A second medic's phone is a distinct LiveKit
  participant with its own `speaker` metadata and gets attributed correctly;
  a patient or bystander talking into the same medic's phone mic cannot be
  separated from the medic by Cartesia.
- **No language auto-detect or translation** at the ASR layer — Cartesia's
  STT doesn't do either. Deferred to phase 4's LLM step.
- Live transcript delivery uses **Broadcast-from-Postgres**
  (`realtime.broadcast_changes` + a trigger), not `postgres_changes`. This
  project's Postgres-changes replication poller got stuck in a dead state
  during testing (a Supabase-side issue, triggered by a real permission bug
  on our end — see `supabase/migrations/0006_*` and `0007_*`) and never
  recovered even after the underlying bug was fixed; Broadcast is also
  Supabase's current recommended approach and doesn't depend on that poller.
  Reports/report_claims (phase 4) use the same pattern (`0008_*`).

**Phase 4 gaps, flagged rather than hidden** (see the module docstring in
`services/ai/app/report_generator.py`):
- Each claim's `confidence` is the LLM's own self-assessment of how
  directly the transcript supports that field — not calibrated, same
  caveat as the ASR placeholder confidence above.
- The model only documents medications/procedures/vitals actually stated
  as given — it never proposes a new one. Triage acuity is the one
  genuinely predictive field; the UI labels it "AI-suggested — confirm
  before acting" and ships its reasoning alongside the score.
- A claim the model can't tie to a real transcript segment index is
  **dropped**, not stored as if it were sourced — traceability is
  enforced server-side, not just a UI convention (see
  `services/ai/tests/test_report_generator.py`).
- The medic's one-tap reject/override flow (`report_claims.human_override`)
  has a column for it but no UI yet — not built in this pass.

**Phase 5 gaps, flagged rather than hidden** (see the module docstring in
`services/ai/app/alerts.py`):
- **Paging is stubbed.** Twilio needs a real account + a way to verify an
  SMS actually lands somewhere, neither practical from this dev
  environment. Every alert logs `PAGING STUB (Twilio not configured) —
  would page <number>: <message>` instead of calling Twilio. Filling in
  `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` in
  `services/ai/.env` is the only change needed to send real SMS — see
  `services/ai/app/paging.py`.
- **Deterioration thresholds are crude placeholders** (fixed HR/SBP/SpO2
  cutoffs and deltas between two report versions), not a validated
  clinical deterioration index like NEWS2 or shock index.
- **Contraindication checking is plain substring matching** between
  reported medications and reported allergies — it has no drug-class or
  cross-reactivity knowledge. A real implementation needs a drug/allergy
  ontology (e.g. RxNorm).
- One paging number per hospital (`hospitals.on_call_phone`), not
  per-team/per-protocol routing (a real system pages cath lab for STEMI,
  neuro for stroke, etc.).
- Alert confidence-gating (`MIN_ALERT_CONFIDENCE` in `alerts.py`) is real
  logic and covered by tests, but is a no-op in practice today since every
  ASR segment reports the same placeholder confidence (see the phase 3 gap
  above) — it'll start doing something the moment that's fixed.

**Phase 6 gaps, flagged rather than hidden** (see the module docstring in
`apps/web/src/lib/offline-queue.ts`):
- **No local ASR fallback.** The spec asks for whisper.cpp running on-device
  so the medic sees *something* during the outage itself. I scoped that out
  of this pass — the best available browser package
  (`@remotion/whisper-web`) needs `SharedArrayBuffer`, which means adding
  cross-origin-isolation headers app-wide, and its own maintainers call it
  experimental and now recommend a different (WebGPU) package with weaker
  phone-browser support. The part that actually prevents data loss — local
  recording, queuing, and reconciliation — doesn't depend on this at all;
  during an outage the medic sees "recording on this device, nothing is
  lost" rather than a live local transcript.
- **A few hundred ms to a couple seconds can still be lost** at the very
  start of a disconnect — MediaRecorder only starts once the app detects
  the drop, and LiveKit's own reconnect grace period runs first. Not
  zero-loss to the millisecond; flagged rather than implied otherwise.
- **Reconciled segment timing is offset-based, not re-anchored.** The
  server trusts the client's `gapStartS` (elapsed time since the mic
  published) and lays the reconciled transcript down from there — it
  doesn't cross-check against the live segment immediately before/after
  the gap. A significant client/server clock or elapsed-time drift would
  skew segment boundaries after the gap.
- Needs `ffmpeg` on the AI service's `PATH` to decode the browser's
  WebM/Opus recording back to PCM — a new local/deployment prerequisite,
  same category as Docker for LiveKit.
- Verified with a full request through the real Next.js route (auth check
  → shared-secret forward → AI service → ffmpeg → Cartesia → DB), using a
  real browser-generated `MediaRecorder` WebM blob from a synthetic audio
  source (no mic needed) rather than the sandboxed test browser's absent
  microphone — plus a direct IndexedDB check confirming out-of-order
  chunks are stored, sorted, and cleared correctly. The
  connection-state-triggered orchestration inside `medic-capture.tsx`
  (auto-start/stop recording on LiveKit disconnect/reconnect) is code-
  reviewed and type-checked but not exercised end-to-end here, since that
  needs `getUserMedia`, which this sandbox's browser doesn't have.

**Phase 7 gaps, flagged rather than hidden:**
- **No incident-closing UI.** An incident just stops appearing once none of
  its transports are `active` anymore — there's no explicit "close this
  incident" action, and no editing an incident's name/kind after creation.
- **Incident membership is medic-declared, not location-inferred.** A crew
  responding to the same physical scene has to actually pick (or type) the
  same incident name when starting their transport; nothing cross-checks
  GPS or dispatch data to group runs automatically.
- Found and fixed a real, unrelated bug while wiring this phase's severity
  sort: `transports.acuity` was never written anywhere — the triage
  acuity score only ever lived inside `reports.soap`. It's now synced
  onto the transport row every time a report regenerates (see
  `report_store.update_transport_acuity`), which is also what makes the
  acuity badge on the ordinary (non-incident) board cards mean anything.
- Verified live: three units tagged to one incident, with different acuity
  scores, correctly group under a collapsed-by-default summary (name, unit
  count, most-severe badge) and expand into a severity-ranked list (most
  severe first), with an unrelated standalone transport staying separate.

## Layout

```
apps/web/       Next.js 15 App Router — medic app, hospital dashboard, auth
services/ai/    FastAPI — capture (ASR) + reasoning (LLM) pipeline, alert fan-out
supabase/       SQL migrations and seed data for the isolated Supabase project
infra/livekit/  Local-dev LiveKit server (Docker Compose) — not for production
```

## Local development

### Local LiveKit (required for phase 2+)

```bash
cd infra/livekit
docker compose up -d
```

Starts a single-node LiveKit server on `ws://localhost:7880` with a fixed dev
key (`devkey` / see `livekit.yaml`) — fine for a laptop demo, not for anything
public. `apps/web/.env.local` and `services/ai/.env` already point at it.

### Web app

```bash
pnpm install
pnpm --filter web dev
```

Copy `apps/web/.env.local.example` to `apps/web/.env.local` and fill in values
(see the table in the original spec for where to get each key). The schema in
[`src/lib/env.ts`](./apps/web/src/lib/env.ts) only requires Supabase vars for
now — LiveKit/AI-service/paging vars become required as later phases land.

### AI service

Needs `ffmpeg` on `PATH` (phase 6 uses it to decode the medic app's offline
recordings) — `winget install Gyan.FFmpeg` on Windows, `brew install ffmpeg`
on macOS, or your distro's package manager on Linux.

```bash
cd services/ai
python -m venv .venv
.venv/Scripts/activate   # or `source .venv/bin/activate` on macOS/Linux
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

Copy `services/ai/.env.example` to `services/ai/.env` and fill in values,
including a Cartesia API key (https://play.cartesia.ai) and a DeepSeek API
key (https://platform.deepseek.com). Twilio vars can stay blank — paging
falls back to a log line until they're set (see the phase 5 gaps above).

Run tests with `.venv/Scripts/python.exe -m pytest` (or `pytest` once the
venv is activated).

### Trying it end to end

1. Start LiveKit (above), the web app, and the AI service.
2. Sign in as a medic (needs a `profiles` row with `role='medic'` and a
   `unit_id` — see `supabase/seed.sql`), go to `/medic`, pick a hospital,
   and hit **Start transport**.
3. The medic page connects to a LiveKit room named `transport-<id>` and
   publishes the mic; the AI service is told (via a shared-secret call from
   the web server action) to join the same room as a silent recorder
   participant, subscribe to that audio, stream it to Cartesia, and write
   finalized transcript chunks to `transcript_segments`.
4. `/medic/<id>` (dark, mobile) shows the transcript updating live as it's
   spoken. `/hospital/<id>` (light, desktop — needs a `profiles` row with
   `role='hospital_staff'` and a `hospital_id`) shows a split view: the
   live SOAP report on the left, the transcript on the right. Every
   report field is clickable — it scrolls to and highlights the exact
   transcript line(s) it came from.
5. After each finalized transcript segment, the AI service re-extracts a
   new report version from the whole transcript so far and writes
   `reports` + `report_claims`. A hospital_staff user can **Sign report**
   once they've reviewed it, which clears the "UNVERIFIED — EN ROUTE" badge.
6. The same extraction also feeds `app/alerts.py`: a protocol match, a
   deterioration finding, or a contraindication each write an `alerts` row
   and log a page (or send one for real, once Twilio is configured). Any
   unacknowledged alert shows as a top-anchored banner (capped at 3) on
   `/hospital/<id>` and as a count badge on the `/hospital` board;
   **Acknowledge** clears it.
7. Raw audio also lands at `services/ai/recordings/<transport_id>/<identity>.wav`.
8. Kill the medic's connection mid-run (e.g. `docker compose stop` in
   `infra/livekit/`) and the medic screen shows "recording on this device,
   nothing is lost" while it buffers audio into IndexedDB locally. Bring
   LiveKit back (`docker compose start`) and it automatically uploads the
   buffered audio to `/api/transports/<id>/reconcile-audio`, which
   decodes, transcribes, and inserts it into the timeline at the correct
   offset — the transcript and report both end up complete with no gap.
9. On `/medic`, optionally name (or pick an existing) mass casualty
   incident before hitting **Start transport**. Other units doing the same
   for the same incident group together on `/hospital` under a
   collapsed-by-default summary (unit count, most severe acuity) — click
   to expand into a severity-ranked list, most severe first. A transport
   not part of an incident behaves exactly as before.

A real phone won't have this microphone problem, but the browser sandbox
used to smoke test this build has none and denies `getUserMedia`, so the
audio-publish half was verified with a small script publishing real speech
(via Windows TTS) into the LiveKit room instead of a live mic — the
room-join/token/capture-trigger path and the live-transcript UI were both
verified through the actual app.

### Database

Migrations live in `supabase/migrations/`, applied in order. `supabase/seed.sql`
has sample org data (one unit, one hospital) for local testing — see the
comment at the bottom for how to attach a `profiles` row to an auth user.

## Isolation

New Supabase project, new everything — this pilot shares no database, no auth
tenant, and no infrastructure with any other system.
