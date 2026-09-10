import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LiveTranscript } from "@/components/live-transcript";

export default async function HospitalTransportPage({
  params,
}: {
  params: Promise<{ transportId: string }>;
}) {
  const { transportId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: transport } = await supabase
    .from("transports")
    .select("id, status, acuity, units(callsign, name)")
    .eq("id", transportId)
    .maybeSingle();

  if (!transport) {
    redirect("/hospital");
  }

  const unit = transport.units as { callsign: string; name: string } | null;

  return (
    <div className="flex flex-1 flex-col gap-6 bg-zinc-50 px-8 py-10">
      <header className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">Incoming from</span>
        <h1 className="text-2xl font-semibold">{unit?.callsign ?? "Unknown unit"}</h1>
      </header>

      <div className="flex-1 rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Live transcript — UNVERIFIED, EN ROUTE
        </h2>
        <LiveTranscript transportId={transport.id} />
      </div>
    </div>
  );
}
