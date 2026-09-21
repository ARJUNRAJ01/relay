"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";

type Alert = Tables<"alerts">;

const KIND_LABEL: Record<string, string> = {
  protocol_match: "Protocol match",
  deterioration: "Deterioration",
  contraindication: "Contraindication",
};

const MAX_VISIBLE = 3;

export function LiveAlerts({ transportId }: { transportId: string }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    supabase
      .from("alerts")
      .select("*")
      .eq("transport_id", transportId)
      .is("acknowledged_at", null)
      .order("fired_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled && data) setAlerts(data);
      });

    const channel = supabase
      .channel(`alerts:${transportId}`, { config: { private: true } })
      .on("broadcast", { event: "INSERT" }, (payload) => {
        const record = (payload.payload as { record: Alert }).record;
        setAlerts((prev) => [record, ...prev]);
      })
      .on("broadcast", { event: "UPDATE" }, (payload) => {
        const record = (payload.payload as { record: Alert }).record;
        setAlerts((prev) =>
          record.acknowledged_at ? prev.filter((a) => a.id !== record.id) : prev.map((a) => (a.id === record.id ? record : a)),
        );
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [transportId]);

  async function acknowledge(alertId: string) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from("alerts")
      .update({ acknowledged_by: user.id, acknowledged_at: new Date().toISOString() })
      .eq("id", alertId);

    if (error) {
      toast.error(error.message);
      return;
    }
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  }

  if (alerts.length === 0) return null;

  const visible = alerts.slice(0, MAX_VISIBLE);
  const overflow = alerts.length - visible.length;

  return (
    <div className="sticky top-0 z-20 flex flex-col gap-2 pb-2">
      {visible.map((alert) => (
        <div
          key={alert.id}
          className="flex items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 shadow-sm"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-destructive-text">
              {KIND_LABEL[alert.kind] ?? alert.kind}
            </span>
            <span className="break-words text-sm text-foreground">{describeAlert(alert)}</span>
          </div>
          <Button
            size="sm"
            variant="destructive"
            className="h-10 shrink-0 px-4"
            onClick={() => acknowledge(alert.id)}
          >
            Acknowledge
          </Button>
        </div>
      ))}
      {overflow > 0 && (
        <p className="text-center text-xs text-destructive-text">+{overflow} more unacknowledged alert(s)</p>
      )}
    </div>
  );
}

function describeAlert(alert: Alert): string {
  const payload = alert.payload as Record<string, unknown>;
  if (typeof payload.summary === "string") return payload.summary;
  if (typeof payload.reasoning === "string" && typeof payload.protocol === "string") {
    return `${String(payload.protocol).toUpperCase()} — ${payload.reasoning}`;
  }
  return JSON.stringify(payload);
}
