import { AccessToken } from "livekit-server-sdk";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

// Mints a short-lived LiveKit token scoped to one room. The caller must be
// authenticated and must actually be assigned to the transport they're
// requesting a token for (checked via the transports RLS-scoped select
// below, not just "any authenticated user").
export async function POST(request: Request) {
  const { transportId } = await request.json();
  if (typeof transportId !== "string" || !transportId) {
    return NextResponse.json({ error: "transportId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: transport, error } = await supabase
    .from("transports")
    .select("id")
    .eq("id", transportId)
    .maybeSingle();
  if (error || !transport) {
    return NextResponse.json({ error: "transport not found or not visible to you" }, { status: 404 });
  }

  // Only the medic app calls this route today, so the publisher is always
  // the medic's own device — this is the sole diarization signal the AI
  // service's capture pipeline has (see services/ai/app/capture.py). A
  // second medic device or a bystander's phone would need its own token
  // route (or a param here) setting a different `speaker` value.
  const token = new AccessToken(serverEnv.LIVEKIT_API_KEY, serverEnv.LIVEKIT_API_SECRET, {
    identity: user.id,
    name: user.email ?? user.id,
    metadata: JSON.stringify({ speaker: "medic" }),
    ttl: "10m",
  });
  token.addGrant({
    room: `transport-${transportId}`,
    roomJoin: true,
    canPublish: true,
    canSubscribe: false,
    canPublishData: false,
  });

  return NextResponse.json({ token: await token.toJwt() });
}
