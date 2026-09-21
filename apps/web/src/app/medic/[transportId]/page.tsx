import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MedicCapture } from "@/components/medic-capture";

export default async function MedicTransportPage({
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
    .select("id, status, hospitals(name)")
    .eq("id", transportId)
    .maybeSingle();

  if (!transport) {
    redirect("/medic");
  }

  return (
    <MedicCapture
      transportId={transport.id}
      hospitalName={(transport.hospitals as { name: string } | null)?.name ?? "Unknown hospital"}
    />
  );
}
