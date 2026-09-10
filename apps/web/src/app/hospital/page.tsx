import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

  const { data: transports } = await supabase
    .from("transports")
    .select("id, status, acuity, eta, started_at, units(callsign, name)")
    .eq("hospital_id", profile.hospital_id)
    .eq("status", "active")
    .order("started_at", { ascending: false });

  const transportIds = (transports ?? []).map((t) => t.id);
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

  return (
    <div className="flex flex-1 flex-col gap-6 bg-zinc-50 px-8 py-10">
      <header>
        <span className="text-sm text-muted-foreground">Incoming board</span>
        <h1 className="text-2xl font-semibold">
          {(profile.hospitals as { name: string } | null)?.name}
        </h1>
      </header>

      {(!transports || transports.length === 0) && (
        <p className="text-sm text-muted-foreground">No active transports right now.</p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(transports ?? []).map((t) => (
          <Link key={t.id} href={`/hospital/${t.id}`}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>
                    {(t.units as { callsign: string; name: string } | null)?.callsign ?? "Unknown unit"}
                  </span>
                  <div className="flex items-center gap-2">
                    {alertCounts.has(t.id) && (
                      <Badge variant="destructive">{alertCounts.get(t.id)} alert(s)</Badge>
                    )}
                    {t.acuity != null && <Badge variant="secondary">Acuity {t.acuity}</Badge>}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Started {new Date(t.started_at).toLocaleTimeString()}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
