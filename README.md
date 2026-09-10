# Relay

Pre-arrival clinical handoff for ambulances. Streams the ambulance-to-hospital
conversation into a structured, live-updating clinical report that lands before
the ambulance does — so the receiving team isn't starting from zero, and the
crew clears the bay faster for the next call.

See [REGULATORY.md](./REGULATORY.md) for the FDA/SaMD posture this pilot is built around.

## Status: Phase 3 — Transcript

- [x] Monorepo layout (`apps/web`, `services/ai`, `supabase/`)
- [x] Supabase project, schema, and RLS (`supabase/migrations/`)
- [x] Auth (Supabase email OTP) with role-scoped profiles (medic / hospital_staff / dispatcher / admin)
- [x] Env validation with zod (web) and pydantic-settings (AI service)
- [x] Audio in: LiveKit room per transport, medic joins from mobile web,
      audio lands on the AI service, raw audio persists to disk — Phase 2
- [x] Transcript: Cartesia streaming STT, live transcript on the medic
      screen and the hospital screen via Supabase Realtime — Phase 3
- [ ] Live SOAP report — Phase 4
- [ ] Alerts — Phase 5
- [ ] Offline queue — Phase 6
- [ ] MCI mode — Phase 7
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

```bash
cd services/ai
python -m venv .venv
.venv/Scripts/activate   # or `source .venv/bin/activate` on macOS/Linux
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

Copy `services/ai/.env.example` to `services/ai/.env` and fill in values,
including a Cartesia API key from https://play.cartesia.ai.

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
4. Both `/medic/<id>` (dark, mobile) and `/hospital/<id>` (light, desktop —
   needs a `profiles` row with `role='hospital_staff'` and a `hospital_id`)
   show the transcript updating live as it's spoken.
5. Raw audio also lands at `services/ai/recordings/<transport_id>/<identity>.wav`.

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
