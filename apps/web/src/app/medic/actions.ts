"use server";

import { redirect } from "next/navigation";
import { serverEnv, env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function startTransport(formData: FormData) {
  const hospitalId = formData.get("hospitalId");
  if (typeof hospitalId !== "string" || !hospitalId) {
    throw new Error("hospitalId is required");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, unit_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "medic" || !profile.unit_id) {
    redirect("/login");
  }

  let incidentId = formData.get("incidentId");
  const newIncidentName = formData.get("newIncidentName");
  if (typeof newIncidentName === "string" && newIncidentName.trim()) {
    const { data: incident, error: incidentError } = await supabase
      .from("incidents")
      .insert({ name: newIncidentName.trim(), kind: "mci" })
      .select("id")
      .single();
    if (incidentError || !incident) {
      throw new Error(incidentError?.message ?? "Failed to create incident");
    }
    incidentId = incident.id;
  }

  const { data: transport, error } = await supabase
    .from("transports")
    .insert({
      unit_id: profile.unit_id,
      hospital_id: hospitalId,
      status: "active",
      incident_id: typeof incidentId === "string" && incidentId ? incidentId : null,
    })
    .select("id")
    .single();

  if (error || !transport) {
    throw new Error(error?.message ?? "Failed to create transport");
  }

  await supabase.from("audit_log").insert({
    transport_id: transport.id,
    actor: user.id,
    action: "transport_started",
    after: { hospital_id: hospitalId, unit_id: profile.unit_id },
  });

  // Best-effort: tell the AI service to join the LiveKit room and start
  // capturing audio. A failure here shouldn't block the medic from getting
  // into the room — capture can be retried, but the transport must exist.
  try {
    await fetch(`${env.NEXT_PUBLIC_AI_SERVICE_URL}/transports/${transport.id}/start-capture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relay-shared-secret": serverEnv.AI_SERVICE_SHARED_SECRET,
      },
      body: JSON.stringify({ room_name: `transport-${transport.id}` }),
    });
  } catch (err) {
    console.error("Failed to start AI capture for transport", transport.id, err);
  }

  redirect(`/medic/${transport.id}`);
}

export async function endTransport(transportId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase
    .from("transports")
    .update({ status: "handed_off" })
    .eq("id", transportId);

  if (error) {
    throw new Error(error.message);
  }

  await supabase.from("audit_log").insert({
    transport_id: transportId,
    actor: user.id,
    action: "transport_ended",
  });

  try {
    await fetch(`${env.NEXT_PUBLIC_AI_SERVICE_URL}/transports/${transportId}/stop-capture`, {
      method: "POST",
      headers: { "x-relay-shared-secret": serverEnv.AI_SERVICE_SHARED_SECRET },
    });
  } catch (err) {
    console.error("Failed to stop AI capture for transport", transportId, err);
  }
}
