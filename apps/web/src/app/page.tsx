import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SignOutButton } from "@/components/sign-out-button";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*, units(callsign, name), hospitals(name)")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="flex flex-1 items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Relay</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {profile ? (
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Role</span>
                <Badge variant="secondary">{profile.role}</Badge>
              </div>
              {profile.units && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Unit</span>
                  <span>
                    {(profile.units as { callsign: string; name: string }).callsign} —{" "}
                    {(profile.units as { callsign: string; name: string }).name}
                  </span>
                </div>
              )}
              {profile.hospitals && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Hospital</span>
                  <span>{(profile.hospitals as { name: string }).name}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No profile row yet — an admin needs to assign your role, unit, or hospital.
            </p>
          )}
          <SignOutButton />
        </CardContent>
      </Card>
    </div>
  );
}
