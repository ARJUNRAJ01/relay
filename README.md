# Relay

Pre-arrival clinical handoff for ambulances. Streams the ambulance-to-hospital
conversation into a structured, live-updating clinical report that lands before
the ambulance does — so the receiving team isn't starting from zero, and the
crew clears the bay faster for the next call.

See [REGULATORY.md](./REGULATORY.md) for the FDA/SaMD posture this pilot is built around.

## Status: Phase 1 — Skeleton

- [x] Monorepo layout (`apps/web`, `services/ai`, `supabase/`)
- [x] Supabase project, schema, and RLS (`supabase/migrations/`)
- [x] Auth (Supabase email OTP) with role-scoped profiles (medic / hospital_staff / dispatcher / admin)
- [x] Env validation with zod (web) and pydantic-settings (AI service)
- [ ] Audio in (LiveKit) — Phase 2
- [ ] Live transcript — Phase 3
- [ ] Live SOAP report — Phase 4
- [ ] Alerts — Phase 5
- [ ] Offline queue — Phase 6
- [ ] MCI mode — Phase 7
- [ ] Polish / accessibility / load test — Phase 8

## Layout

```
apps/web/       Next.js 15 App Router — medic app, hospital dashboard, auth
services/ai/    FastAPI — capture (ASR) + reasoning (LLM) pipeline, alert fan-out
supabase/       SQL migrations and seed data for the isolated Supabase project
```

## Local development

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

### Database

Migrations live in `supabase/migrations/`, applied in order. `supabase/seed.sql`
has sample org data (one unit, one hospital) for local testing — see the
comment at the bottom for how to attach a `profiles` row to an auth user.

## Isolation

New Supabase project, new everything — this pilot shares no database, no auth
tenant, and no infrastructure with any other system.
