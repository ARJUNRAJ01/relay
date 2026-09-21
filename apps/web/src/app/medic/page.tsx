import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { startTransport } from "@/app/medic/actions";

export default async function MedicHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, unit_id, units(callsign, name)")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || profile.role !== "medic") {
    return (
      <div className="dark flex flex-1 items-center justify-center bg-background px-4">
        <p className="text-muted-foreground">This screen is for medic accounts only.</p>
      </div>
    );
  }

  const { data: hospitals } = await supabase.from("hospitals").select("id, name").order("name");
  const { data: openIncidents } = await supabase
    .from("incidents")
    .select("id, name")
    .is("closed_at", null)
    .order("opened_at", { ascending: false });

  return (
    <div className="dark flex flex-1 flex-col items-center justify-center gap-6 bg-background px-4 py-16 text-foreground">
      <Card className="w-full max-w-sm border-border bg-card text-card-foreground">
        <CardHeader>
          <CardTitle>Start transport</CardTitle>
          <CardDescription className="text-muted-foreground">
            {profile.units ? (
              <>
                {(profile.units as { callsign: string; name: string }).callsign} —{" "}
                {(profile.units as { callsign: string; name: string }).name}
              </>
            ) : (
              "No unit assigned"
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={startTransport} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="hospitalId" className="text-sm text-muted-foreground">
                Receiving hospital
              </label>
              <select
                id="hospitalId"
                name="hospitalId"
                required
                className="h-14 rounded-md border border-input bg-background px-3 text-base text-foreground"
              >
                {(hospitals ?? []).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <label htmlFor="incidentId" className="text-sm text-muted-foreground">
                Mass casualty incident (optional)
              </label>
              <select
                id="incidentId"
                name="incidentId"
                defaultValue=""
                className="h-14 rounded-md border border-input bg-background px-3 text-base text-foreground"
              >
                <option value="">Not part of an incident</option>
                {(openIncidents ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                name="newIncidentName"
                placeholder="…or name a new incident (e.g. I-95 pileup)"
                className="h-14 rounded-md border border-input bg-background px-3 text-base text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <Button type="submit" className="h-14 text-base">
              Start transport
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
