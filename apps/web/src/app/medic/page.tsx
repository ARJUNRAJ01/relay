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
      <div className="flex flex-1 items-center justify-center bg-zinc-950 px-4">
        <p className="text-zinc-400">This screen is for medic accounts only.</p>
      </div>
    );
  }

  const { data: hospitals } = await supabase.from("hospitals").select("id, name").order("name");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-950 px-4 py-16 text-zinc-50">
      <Card className="w-full max-w-sm border-zinc-800 bg-zinc-900 text-zinc-50">
        <CardHeader>
          <CardTitle>Start transport</CardTitle>
          <CardDescription className="text-zinc-400">
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
              <label htmlFor="hospitalId" className="text-sm text-zinc-400">
                Receiving hospital
              </label>
              <select
                id="hospitalId"
                name="hospitalId"
                required
                className="h-12 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-base text-zinc-50"
              >
                {(hospitals ?? []).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
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
