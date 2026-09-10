"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setLoading(true);

  const supabase = createClient();

  const password =
    email === "demo.hospital@relay.test"
      ? "Demo123456!"
      : "Demo123456!";

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  setLoading(false);

  if (error) {
    toast.error(error.message);
    return;
  }

  if (!data.user) {
    toast.error("No user returned.");
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile) {
    toast.error("Could not load user profile.");
    return;
  }

  if (profile.role === "hospital_staff") {
    window.location.href = "/hospital";
    return;
  }

  if (profile.role === "medic") {
    window.location.href = "/medic";
    return;
  }

  toast.error("Unknown account role.");
}
  return (
    <div className="flex flex-1 items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Relay</CardTitle>
          <CardDescription>
            Demo medic login
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>

              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="medicdemo@gmail.com"
              />
            </div>

            <Button type="submit" disabled={loading} className="h-14">
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}