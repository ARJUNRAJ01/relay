import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Unit = { callsign: string; name: string } | null;
type Incident = { name: string; kind: string } | null;
type Transport = {
  id: string;
  status: string;
  acuity: number | null;
  eta: string | null;
  started_at: string;
  incident_id: string | null;
  units: Unit;
  incidents: Incident;
};

export default async function HospitalBoard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, hospital_id, hospitals(name)")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "hospital_staff" || !profile.hospital_id) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4">
        <p className="text-muted-foreground">This screen is for hospital staff accounts only.</p>
      </div>
    );
  }

  const { data: transportRows } = await supabase
    .from("transports")
    .select("id, status, acuity, eta, started_at, incident_id, units(callsign, name), incidents(name, kind)")
    .eq("hospital_id", profile.hospital_id)
    .eq("status", "active")
    .order("started_at", { ascending: false });

  const transports = (transportRows ?? []) as unknown as Transport[];

  const transportIds = transports.map((t) => t.id);
  const { data: unacknowledged } = transportIds.length
    ? await supabase
        .from("alerts")
        .select("transport_id")
        .in("transport_id", transportIds)
        .is("acknowledged_at", null)
    : { data: [] };
  const alertCounts = new Map<string, number>();
  for (const row of unacknowledged ?? []) {
    alertCounts.set(row.transport_id, (alertCounts.get(row.transport_id) ?? 0) + 1);
  }

  const standalone = transports.filter((t) => !t.incident_id);
  const incidentGroups = new Map<string, Transport[]>();
  for (const t of transports) {
    if (!t.incident_id) continue;
    const group = incidentGroups.get(t.incident_id) ?? [];
    group.push(t);
    incidentGroups.set(t.incident_id, group);
  }

  // Severity-ranked: lower acuity number = more severe (ESI convention),
  // nulls (no report yet) sort last within their group.
  const bySeverity = (a: Transport, b: Transport) => {
    if (a.acuity == null && b.acuity == null) return 0;
    if (a.acuity == null) return 1;
    if (b.acuity == null) return -1;
    return a.acuity - b.acuity;
  };

  const sortedIncidents = Array.from(incidentGroups.entries())
    .map(([incidentId, group]) => ({
      incidentId,
      name: group[0].incidents?.name ?? "Incident",
      transports: [...group].sort(bySeverity),
      minAcuity: Math.min(...group.map((t) => t.acuity ?? 99)),
      alertTotal: group.reduce((sum, t) => sum + (alertCounts.get(t.id) ?? 0), 0),
    }))
    // Most severe incident (lowest min acuity) first.
    .sort((a, b) => a.minAcuity - b.minAcuity);

  const sortedStandalone = [...standalone].sort(bySeverity);

  return (
    <div className="flex flex-1 flex-col gap-6 bg-zinc-50 px-8 py-10">
      <header>
        <span className="text-sm text-muted-foreground">Incoming board</span>
        <h1 className="text-2xl font-semibold">
          {(profile.hospitals as { name: string } | null)?.name}
        </h1>
      </header>

      {transports.length === 0 && <p className="text-sm text-muted-foreground">No active transports right now.</p>}

      {sortedIncidents.map((group) => (
        <details key={group.incidentId} className="rounded-2xl border border-red-200 bg-red-50">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-red-700">Incident</span>
              <span className="text-base font-semibold text-red-950">{group.name}</span>
              <Badge variant="secondary">{group.transports.length} unit(s)</Badge>
            </div>
            <div className="flex items-center gap-2">
              {group.alertTotal > 0 && <Badge variant="destructive">{group.alertTotal} alert(s)</Badge>}
              {group.minAcuity < 99 && <Badge variant="outline">Most severe: acuity {group.minAcuity}</Badge>}
            </div>
          </summary>
          <div className="grid grid-cols-1 gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
            {group.transports.map((t) => (
              <TransportCard key={t.id} transport={t} alertCount={alertCounts.get(t.id) ?? 0} />
            ))}
          </div>
        </details>
      ))}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sortedStandalone.map((t) => (
          <TransportCard key={t.id} transport={t} alertCount={alertCounts.get(t.id) ?? 0} />
        ))}
      </div>
    </div>
  );
}

function TransportCard({ transport, alertCount }: { transport: Transport; alertCount: number }) {
  return (
    <Link href={`/hospital/${transport.id}`}>
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>{transport.units?.callsign ?? "Unknown unit"}</span>
            <div className="flex items-center gap-2">
              {alertCount > 0 && <Badge variant="destructive">{alertCount} alert(s)</Badge>}
              {transport.acuity != null && <Badge variant="secondary">Acuity {transport.acuity}</Badge>}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Started {new Date(transport.started_at).toLocaleTimeString()}
        </CardContent>
      </Card>
    </Link>
  );
}
