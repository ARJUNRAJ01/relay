"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

// Every LLM-produced field ships with a self-reported confidence — see the
// module docstring in services/ai/app/report_generator.py for why that
// number is a display aid, not yet something alert-gating logic can trust.
const LOW_CONFIDENCE_THRESHOLD = 0.5;

export function LiveReport({
  transportId,
  onSourceClick,
}: {
  transportId: string;
  onSourceClick?: (segmentIds: string[]) => void;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [signing, setSigning] = useState(false);
  // Broadcast callbacks close over the render they were created in, so
  // reading `report` inside them would see a stale value forever (the
  // effect only runs once, on transportId change). Track the current
  // report id in a ref instead, updated synchronously alongside state.
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
      if (latest) {
        const { data: claimRows } = await supabase
          .from("report_claims")
          .select("*")
          .eq("report_id", latest.id);
        if (!cancelled) setClaims(claimRows ?? []);
      }
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
            setClaims([]);
          }
        } else if (p.table === "report_claims") {
          const claim = p.record as Claim;
          if (claim.report_id === currentReportIdRef.current) {
            setClaims((prev) => [...prev, claim]);
          }
        }
      })
      .on("broadcast", { event: "UPDATE" }, (payload) => {
        const p = payload.payload as { table: string; record: Report };
        if (p.table === "reports" && p.record.id === currentReportIdRef.current) {
          setReport(p.record);
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [transportId]);

  async function handleSign() {
    setSigning(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !report) {
      setSigning(false);
      return;
    }
    const { error } = await supabase
      .from("reports")
      .update({ signed_by: user.id, signed_at: new Date().toISOString() })
      .eq("id", report.id);
    setSigning(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setReport({ ...report, signed_by: user.id, signed_at: new Date().toISOString() });
  }

  if (!report) {
    return <p className="text-sm text-muted-foreground">Waiting for the first report…</p>;
  }

  const soap = report.soap as Soap;
  const claimsByField = new Map(claims.map((c) => [c.field, c]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Badge
          variant="outline"
          className={report.signed_by ? "border-success/30 bg-success/10 text-success-text" : "border-warning/30 bg-warning/10 text-warning-text"}
        >
          {report.signed_by ? "Signed" : "UNVERIFIED — EN ROUTE"}
        </Badge>
        {!report.signed_by && (
          <Button size="sm" onClick={handleSign} disabled={signing}>
            {signing ? "Signing…" : "Sign report"}
          </Button>
        )}
      </div>

      {soap.chief_complaint && (
        <Section title="Chief complaint">
          <ClaimSource claim={claimsByField.get("chief_complaint")} onSourceClick={onSourceClick}>
            {soap.chief_complaint}
          </ClaimSource>
        </Section>
      )}

      {soap.triage_acuity && (
        <Section title="Triage acuity (AI-suggested — confirm before acting)">
          <ClaimSource claim={claimsByField.get("triage_acuity")} onSourceClick={onSourceClick}>
            <span className="font-semibold">Level {soap.triage_acuity.score}</span> —{" "}
            {soap.triage_acuity.reasoning}
          </ClaimSource>
        </Section>
      )}

      {soap.soap && (
        <Section title="SOAP">
          <div className="flex flex-col gap-2 text-sm">
            {soap.soap.subjective && (
              <p>
                <span className="font-medium">S: </span>
                <ClaimSource claim={claimsByField.get("soap.subjective")} onSourceClick={onSourceClick}>
                  {soap.soap.subjective}
                </ClaimSource>
              </p>
            )}
            {soap.soap.objective && (
              <p>
                <span className="font-medium">O: </span>
                <ClaimSource claim={claimsByField.get("soap.objective")} onSourceClick={onSourceClick}>
                  {soap.soap.objective}
                </ClaimSource>
              </p>
            )}
            {soap.soap.assessment && (
              <p>
                <span className="font-medium">A: </span>
                <ClaimSource claim={claimsByField.get("soap.assessment")} onSourceClick={onSourceClick}>
                  {soap.soap.assessment}
                </ClaimSource>
              </p>
            )}
            {soap.soap.plan && (
              <p>
                <span className="font-medium">P: </span>
                <ClaimSource claim={claimsByField.get("soap.plan")} onSourceClick={onSourceClick}>
                  {soap.soap.plan}
                </ClaimSource>
              </p>
            )}
          </div>
        </Section>
      )}

      {!!soap.vitals?.length && (
        <Section title="Vitals">
          <ul className="flex flex-col gap-1 text-sm">
            {soap.vitals.map((v, i) => (
              <li key={i}>
                <ClaimSource claim={claimsByField.get(`vitals[${i}]`)} onSourceClick={onSourceClick}>
                  <span className="uppercase text-muted-foreground">{v.type}</span> {v.value}
                </ClaimSource>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!!soap.medications?.length && (
        <Section title="Medications given">
          <ul className="flex flex-col gap-1 text-sm">
            {soap.medications.map((m, i) => (
              <li key={i}>
                <ClaimSource claim={claimsByField.get(`medications[${i}]`)} onSourceClick={onSourceClick}>
                  {m.name} — {m.dose} {m.route}
                </ClaimSource>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!!soap.procedures?.length && (
        <Section title="Procedures">
          <ul className="flex flex-col gap-1 text-sm">
            {soap.procedures.map((p, i) => (
              <li key={i}>
                <ClaimSource claim={claimsByField.get(`procedures[${i}]`)} onSourceClick={onSourceClick}>
                  {p.name}
                </ClaimSource>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!!soap.predicted_resources?.length && (
        <Section title="Prepare for arrival">
          <div className="flex flex-wrap gap-2">
            {soap.predicted_resources.map((r, i) => (
              <Badge key={i} variant="outline">
                {r}
              </Badge>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function ClaimSource({
  claim,
  onSourceClick,
  children,
}: {
  claim: Claim | undefined;
  onSourceClick?: (segmentIds: string[]) => void;
  children: React.ReactNode;
}) {
  const low = claim && claim.confidence < LOW_CONFIDENCE_THRESHOLD;
  return (
    <button
      type="button"
      disabled={!claim}
      onClick={() => claim && onSourceClick?.(claim.source_segment_ids)}
      className={`text-left ${claim ? "cursor-pointer underline decoration-dotted underline-offset-2 hover:decoration-solid" : ""} ${low ? "text-warning-text" : ""}`}
      title={claim ? `Confidence: ${(claim.confidence * 100).toFixed(0)}% — click to view source` : undefined}
    >
      {children}
    </button>
  );
}
