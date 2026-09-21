import { NextResponse } from "next/server";
import { serverEnv, env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

// The AI service trusts a shared secret, which must never reach the
// browser — this route holds it server-side and re-checks the caller
// actually owns the transport (via the same RLS-scoped select used by the
// LiveKit token route) before forwarding the upload.
export async function POST(request: Request, { params }: { params: Promise<{ transportId: string }> }) {
  const { transportId } = await params;

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

  const incomingForm = await request.formData();
  const audio = incomingForm.get("audio");
  const gapStartS = incomingForm.get("gapStartS");
  if (!(audio instanceof Blob) || typeof gapStartS !== "string") {
    return NextResponse.json({ error: "audio and gapStartS are required" }, { status: 400 });
  }

  const outgoingForm = new FormData();
  outgoingForm.set("audio", audio, "gap.webm");
  outgoingForm.set("identity", user.id);
  outgoingForm.set("speaker", "medic");
  outgoingForm.set("gap_start_s", gapStartS);

  const response = await fetch(`${env.NEXT_PUBLIC_AI_SERVICE_URL}/transports/${transportId}/reconcile-audio`, {
    method: "POST",
    headers: { "x-relay-shared-secret": serverEnv.AI_SERVICE_SHARED_SECRET },
    body: outgoingForm,
  });

  if (!response.ok) {
    return NextResponse.json({ error: await response.text() }, { status: 502 });
  }
  return NextResponse.json({ status: "reconciled" });
}
