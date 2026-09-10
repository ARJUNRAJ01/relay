"use client";

import { useState } from "react";
import { LiveReport } from "@/components/live-report";
import { LiveTranscript } from "@/components/live-transcript";

export function HospitalSplitView({ transportId }: { transportId: string }) {
  const [highlightedSegmentIds, setHighlightedSegmentIds] = useState<string[]>([]);

  return (
    <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="overflow-y-auto rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          SOAP report
        </h2>
        <LiveReport transportId={transportId} onSourceClick={setHighlightedSegmentIds} />
      </div>

      <div className="overflow-y-auto rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Live transcript
        </h2>
        <LiveTranscript transportId={transportId} highlightedSegmentIds={highlightedSegmentIds} />
      </div>
    </div>
  );
}
