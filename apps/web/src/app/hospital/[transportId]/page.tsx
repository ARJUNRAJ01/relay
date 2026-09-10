import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { HospitalSplitView } from "@/components/hospital-split-view";

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
    .select("id, status, acuity, incident_id, units(callsign, name), incidents(name)")
    .eq("id", transportId)
    .maybeSingle();

  if (!transport) {
    redirect("/hospital");
  }

  const unit = transport.units as { callsign: string; name: string } | null;
  const incident = transport.incidents as { name: string } | null;

  return (
    <div className="flex flex-1 flex-col gap-6 bg-zinc-50 px-8 py-10">
      <header className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">Incoming from</span>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{unit?.callsign ?? "Unknown unit"}</h1>
          {incident && (
            <Link href="/hospital">
              <Badge variant="destructive">Incident: {incident.name}</Badge>
            </Link>
          )}
        </div>
      </header>

      <HospitalSplitView transportId={transport.id} />
    </div>
  );
}
