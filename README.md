# Relay

Pre-arrival clinical handoff for ambulances. Streams the ambulance-to-hospital
conversation into a structured, live-updating clinical report that lands before
the ambulance does — so the receiving team isn't starting from zero, and the
crew clears the bay faster for the next call.

See [REGULATORY.md](./REGULATORY.md) for the FDA/SaMD posture this pilot is built around.

## Status: Phase 2 — Audio in

- [x] Monorepo layout (`apps/web`, `services/ai`, `supabase/`)
- [x] Supabase project, schema, and RLS (`supabase/migrations/`)
- [x] Auth (Supabase email OTP) with role-scoped profiles (medic / hospital_staff / dispatcher / admin)
- [x] Env validation with zod (web) and pydantic-settings (AI service)
- [x] Audio in: LiveKit room per transport, medic joins from mobile web,
      audio lands on the AI service, raw audio persists to disk — Phase 2
- [ ] Live transcript — Phase 3
- [ ] Live SOAP report — Phase 4
- [ ] Alerts — Phase 5
- [ ] Offline queue — Phase 6
- [ ] MCI mode — Phase 7
- [ ] Polish / accessibility / load test — Phase 8

**Phase 2 note:** this is running fully local for now (self-hosted LiveKit via
Docker, audio persisted to local disk) rather than LiveKit Cloud + R2, to get
a demoable prototype fast. See "Local LiveKit" below and the `AUDIO_STORAGE_BACKEND`
var for how to swap to the cloud versions later — the capture code doesn't
change, only which URLs/keys it points at.

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

Copy `services/ai/.env.example` to `services/ai/.env` and fill in values.

Run tests with `.venv/Scripts/python.exe -m pytest` (or `pytest` once the
venv is activated).

### Trying phase 2 end to end

1. Start LiveKit (above), the web app, and the AI service.
2. Sign in as a medic (needs a `profiles` row with `role='medic'` and a
   `unit_id` — see `supabase/seed.sql`), go to `/medic`, pick a hospital,
   and hit **Start transport**.
3. The medic page connects to a LiveKit room named `transport-<id>` and
   publishes the mic; the AI service is told (via a shared-secret call from
   the web server action) to join the same room as a silent recorder
   participant and subscribe to that audio.
4. Raw audio lands at `services/ai/recordings/<transport_id>/<identity>.wav`.
   Nothing is transcribed yet — that's phase 3.

A real phone won't have this problem, but the browser sandbox used to smoke
test this build has no microphone and denies `getUserMedia`, so the
audio-publish half was verified with a synthetic-tone test script instead of
a real mic — the room join/token/capture-trigger path was verified live
through the actual UI.

### Database

Migrations live in `supabase/migrations/`, applied in order. `supabase/seed.sql`
has sample org data (one unit, one hospital) for local testing — see the
comment at the bottom for how to attach a `profiles` row to an auth user.

## Isolation

New Supabase project, new everything — this pilot shares no database, no auth
tenant, and no infrastructure with any other system.
