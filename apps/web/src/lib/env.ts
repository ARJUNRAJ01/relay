import { z } from "zod";

// An unset var in a .env file (e.g. `NEXT_PUBLIC_AI_SERVICE_URL=`) comes
// through as "" from process.env, not undefined — normalize so `.optional()`
// actually treats it as unset instead of failing `.url()`/`.min(1)` on empty.
function blankToUndefined(value: unknown) {
  return value === "" ? undefined : value;
}
const optionalString = () => z.preprocess(blankToUndefined, z.string().min(1).optional());

// Phase 1+2 need Supabase and LiveKit to run. Paging/mapping/error-reporting
// wiring lands in later phases — keep those optional so `next dev` doesn't
// hard-fail before those services exist, but every var Relay will eventually
// depend on is still declared and shaped up front.
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  AI_SERVICE_SHARED_SECRET: z.string().min(1),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_LIVEKIT_URL: z.string().min(1),
  NEXT_PUBLIC_AI_SERVICE_URL: z.string().url(),
  NEXT_PUBLIC_SENTRY_DSN: optionalString(),
  NEXT_PUBLIC_MAPBOX_TOKEN: optionalString(),
});

const clientEnv = clientSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_LIVEKIT_URL: process.env.NEXT_PUBLIC_LIVEKIT_URL,
  NEXT_PUBLIC_AI_SERVICE_URL: process.env.NEXT_PUBLIC_AI_SERVICE_URL,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
});

// Server-only values must never be imported from a "use client" module.
// Accessing `serverEnv` at build time on the client bundle throws, by design.
function getServerEnv() {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv must not be accessed from client code");
  }
  return serverSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
    AI_SERVICE_SHARED_SECRET: process.env.AI_SERVICE_SHARED_SECRET,
  });
}

export const env = clientEnv;
export const serverEnv = new Proxy({} as z.infer<typeof serverSchema>, {
  get(_target, prop: string) {
    return getServerEnv()[prop as keyof z.infer<typeof serverSchema>];
  },
});
