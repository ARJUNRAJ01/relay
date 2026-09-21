"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";

type Report = Tables<"reports">;
type Claim = Tables<"report_claims">;

interface Soap {
  chief_complaint?: string;
  soap?: { subjective?: string; objective?: string; assessment?: string; plan?: string };
  vitals?: { type: string; value: string; time_s: number | null }[];
  medications?: { name: string; dose: string; route: string; time_s: number | null }[];
  procedures?: { name: string; time_s: number | null }[];
  allergies?: string[];
  predicted_resources?: string[];
  triage_acuity?: { score: number; reasoning: string };
}

const ACUITY_COLOR: Record<number, string> = {
  1: "bg-red-600 text-white",
  2: "bg-orange-500 text-white",
  3: "bg-yellow-500 text-black",
  4: "bg-green-500 text-white",
  5: "bg-blue-400 text-white",
};

const ACUITY_LABEL: Record<number, string> = {
  1: "Critical",
  2: "Emergent",
  3: "Urgent",
  4: "Less Urgent",
  5: "Non-Urgent",
};

const VITAL_LABEL: Record<string, string> = {
  bp: "Blood Pressure", hr: "Heart Rate", rr: "Resp. Rate",
  spo2: "SpO2", temp: "Temperature", gcs: "GCS",
};

export function LiveReport({ transportId }: { transportId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const currentReportIdRef = useRef<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function loadLatest() {
      const { data: latest } = await supabase
        .from("reports")
        .select("*")
        .eq("transport_id", transportId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setReport(latest);
      currentReportIdRef.current = latest?.id ?? null;
    }

    loadLatest();

    const channel = supabase
      .channel(`reports:${transportId}`, { config: { private: true } })
      .on("broadcast", { event: "INSERT" }, (payload) => {
        const p = payload.payload as { table: string; record: Report | Claim };
        if (p.table === "reports") {
          const incoming = p.record as Report;
          if (currentReportIdRef.current !== incoming.id) {
            currentReportIdRef.current = incoming.id;
            setReport(incoming);
          }
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [transportId]);

  async function handleSign() {
    if (!report) return;
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from("reports")
      .update({ signed_by: user.id, signed_at: new Date().toISOString() })
      .eq("id", report.id);
    if (error) { toast.error(error.message); return; }
    setReport({ ...report, signed_by: user.id, signed_at: new Date().toISOString() });
  }

  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
        <p className="text-sm text-muted-foreground">Waiting for medic report…</p>
      </div>
    );
  }

  const soap = report.soap as Soap;
  const acuity = soap.triage_acuity?.score;

  return (
    <div className="flex flex-col gap-5">

      {/* ── Status bar ── */}
      <div className="flex items-center justify-between">
        <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${report.signed_by ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
          {report.signed_by ? "✓ Signed" : "En route — unverified"}
        </span>
        {!report.signed_by && (
          <button
            onClick={handleSign}
            className="rounded-lg bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:opacity-80"
          >
            Sign report
          </button>
        )}
      </div>

      {/* ── Patient summary card ── */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Chief complaint</p>
            <p className="mt-1 text-xl font-semibold text-foreground">
              {soap.chief_complaint ?? "—"}
            </p>
            {soap.soap?.assessment && (
              <p className="mt-2 text-sm text-muted-foreground">{soap.soap.assessment}</p>
            )}
          </div>
          {acuity && (
            <div className={`flex flex-col items-center rounded-xl px-4 py-2 ${ACUITY_COLOR[acuity] ?? "bg-muted text-foreground"}`}>
              <span className="text-2xl font-black">{acuity}</span>
              <span className="text-xs font-semibold">{ACUITY_LABEL[acuity]}</span>
            </div>
          )}
        </div>
        {acuity && soap.triage_acuity?.reasoning && (
          <p className="mt-3 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">AI assessment: </span>
            {soap.triage_acuity.reasoning}
          </p>
        )}
      </div>

      {/* ── Vitals ── */}
      {!!soap.vitals?.length && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vitals</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {soap.vitals.map((v, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-4 text-center shadow-sm">
                <p className="text-xs text-muted-foreground">{VITAL_LABEL[v.type] ?? v.type.toUpperCase()}</p>
                <p className="mt-1 text-2xl font-bold text-foreground">{v.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Medications given ── */}
      {!!soap.medications?.length && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Medications given</p>
          <div className="flex flex-col gap-2">
            {soap.medications.map((m, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2">
                <span className="text-lg">💊</span>
                <div>
                  <p className="text-sm font-semibold text-foreground">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.dose} {m.route}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Allergies ── */}
      {!!soap.allergies?.length && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-destructive">⚠ Allergies</p>
          <div className="flex flex-wrap gap-2">
            {soap.allergies.map((a, i) => (
              <span key={i} className="rounded-full border border-destructive/30 px-3 py-1 text-sm font-medium text-destructive">{a}</span>
            ))}
          </div>
        </div>
      )}

      {/* ── Prepare for arrival ── */}
      {!!soap.predicted_resources?.length && (
        <div className="rounded-2xl border-2 border-primary/20 bg-primary/5 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-primary">🏥 Prepare for arrival</p>
          <div className="flex flex-col gap-2">
            {soap.predicted_resources.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-sm font-medium text-foreground">
                <span className="text-primary">→</span> {r}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Procedures ── */}
      {!!soap.procedures?.length && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Procedures done</p>
          <div className="flex flex-col gap-1">
            {soap.procedures.map((p, i) => (
              <p key={i} className="text-sm text-foreground">• {p.name}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
