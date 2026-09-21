"use client";

import { useState } from "react";
import { LiveAlerts } from "@/components/live-alerts";
import { LiveReport } from "@/components/live-report";
import { LiveTranscript } from "@/components/live-transcript";

export function HospitalSplitView({ transportId }: { transportId: string }) {
  const [showTranscript, setShowTranscript] = useState(false);

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Alerts always on top */}
      <LiveAlerts transportId={transportId} />

      {/* Main report — full width, clean */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <LiveReport transportId={transportId} />
      </div>

      {/* Transcript — collapsed by default, toggle to expand */}
      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <button
          onClick={() => setShowTranscript((v) => !v)}
          className="flex w-full items-center justify-between px-6 py-4 text-left"
        >
          <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Live transcript
          </span>
          <span className="text-xs text-muted-foreground">{showTranscript ? "▲ Hide" : "▼ Show"}</span>
        </button>
        {showTranscript && (
          <div className="border-t border-border px-6 pb-6 pt-4">
            <LiveTranscript transportId={transportId} highlightedSegmentIds={[]} />
          </div>
        )}
      </div>
    </div>
  );
}
