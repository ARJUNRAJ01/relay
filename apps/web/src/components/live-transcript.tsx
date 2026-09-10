"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";

type Segment = Tables<"transcript_segments">;

const SPEAKER_LABEL: Record<string, string> = {
  medic: "Medic",
  medic_2: "Medic 2",
  patient: "Patient",
  bystander: "Bystander",
  unknown: "Unknown",
};

// Cartesia's streaming STT reports no confidence score at all (see
// services/ai/app/asr/cartesia.py) — every segment lands with confidence=1.0
// as a placeholder. This threshold exists so the UI treats low-confidence
// spans differently the moment a provider that actually reports confidence
// is wired in, without needing another round of UI changes.
const LOW_CONFIDENCE_THRESHOLD = 0.5;

export function LiveTranscript({ transportId, dark = false }: { transportId: string; dark?: boolean }) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    supabase
      .from("transcript_segments")
      .select("*")
      .eq("transport_id", transportId)
      .order("t_start", { ascending: true })
      .then(({ data }) => {
        if (!cancelled && data) setSegments(data);
      });

    // Broadcast-from-Postgres, not postgres_changes: this project's realtime
    // tenant had a dead WAL-polling CDC connection (Supabase-side, unrelated
    // to our schema) that never recovered even after the RLS-helper-function
    // permission bug behind it was fixed. Broadcast is also Supabase's
    // current recommended approach — see supabase/migrations/…_transcript_broadcast.sql
    // for the trigger and the realtime.messages authorization policy this
    // depends on.
    const channel = supabase
      .channel(`transcript:${transportId}`, { config: { private: true } })
      .on("broadcast", { event: "INSERT" }, (payload) => {
        const record = (payload.payload as { record: Segment }).record;
        setSegments((prev) => [...prev, record]);
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [transportId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments.length]);

  const emptyText = dark ? "text-zinc-500" : "text-muted-foreground";

  if (segments.length === 0) {
    return <p className={`text-sm ${emptyText}`}>Waiting for transcript…</p>;
  }

  return (
    <div className="flex flex-col gap-3 overflow-y-auto">
      {segments.map((segment) => (
        <TranscriptLine key={segment.id} segment={segment} dark={dark} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function TranscriptLine({ segment, dark }: { segment: Segment; dark: boolean }) {
  const lowConfidence = segment.confidence < LOW_CONFIDENCE_THRESHOLD;
  const labelColor = dark ? "text-zinc-500" : "text-muted-foreground";
  const textColor = lowConfidence ? "text-amber-500" : dark ? "text-zinc-100" : "text-foreground";

  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-xs uppercase tracking-wide ${labelColor}`}>
        {SPEAKER_LABEL[segment.speaker] ?? segment.speaker}
        {lowConfidence && " · low confidence"}
      </span>
      <span className={`text-sm leading-snug ${textColor}`}>{segment.text}</span>
    </div>
  );
}
