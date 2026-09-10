"use client";

import { useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  ConnectionState,
  LocalAudioTrack,
} from "livekit-client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LiveTranscript } from "@/components/live-transcript";
import { env } from "@/lib/env";
import { endTransport } from "@/app/medic/actions";

type Status = "connecting" | "connected" | "disconnected" | "error";

export function MedicCapture({
  transportId,
  hospitalName,
}: {
  transportId: string;
  hospitalName: string;
}) {
  const [status, setStatus] = useState<Status>("connecting");
  const [level, setLevel] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const levelCleanupRef = useRef<(() => void) | null>(null);

  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const room = new Room();
    roomRef.current = room;

    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (cancelled) return;

      if (state === ConnectionState.Connected) {
        setStatus("connected");
      } else if (state === ConnectionState.Reconnecting) {
        setStatus("connecting");
      } else if (state === ConnectionState.Disconnected) {
        setStatus("disconnected");
      }
    });

    async function connect() {
      try {
        setStatus("connecting");

        // Get LiveKit access token from Next.js API route
        const res = await fetch("/api/livekit/token", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            transportId,
          }),
        });

        if (!res.ok) {
          throw new Error(await res.text());
        }

        const { token } = await res.json();

        if (cancelled) return;

        // Connect browser to LiveKit
        await room.connect(env.NEXT_PUBLIC_LIVEKIT_URL, token);

        if (cancelled) {
          await room.disconnect();
          return;
        }

        // Enable and publish microphone
        await room.localParticipant.setMicrophoneEnabled(true);

        if (cancelled) {
          await room.disconnect();
          return;
        }

        setStatus("connected");

        // Find published microphone track
        const micPublication = Array.from(
          room.localParticipant.trackPublications.values(),
        ).find((publication) => publication.track instanceof LocalAudioTrack);

        const track = micPublication?.track;

        if (track instanceof LocalAudioTrack && track.mediaStreamTrack) {
          // Start visual microphone level meter
          levelCleanupRef.current?.();

          levelCleanupRef.current = startLevelMeter(
            track.mediaStreamTrack,
            (value) => {
              if (!cancelled) {
                setLevel(value);
              }
            },
          );
        }
      } catch (err) {
        console.error("LiveKit connection error:", err);

        if (!cancelled) {
          setStatus("error");

          const message =
            err instanceof Error ? err.message : "Unknown connection error";

          toast.error(`Could not connect to transport room: ${message}`);
        }
      }
    }

    void connect();

    return () => {
      cancelled = true;

      // Stop microphone level analyser
      levelCleanupRef.current?.();
      levelCleanupRef.current = null;

      // Disconnect cleanly
      void room.disconnect();

      roomRef.current = null;
    };
  }, [transportId]);

async function handleEnd() {
  try {
    await roomRef.current?.disconnect();
    await endTransport(transportId);

    toast.success("Transport ended successfully.");

    // Stay on this page for demo instead of triggering auth redirect
    setStatus("disconnected");
  } catch (err) {
    console.error("Failed to end transport:", err);
    toast.error("Could not end transport.");
  }
}

  return (
    <div className="dark flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex flex-col gap-1 px-6 pb-4 pt-8">
        <span className="text-sm text-muted-foreground">En route to</span>

        <h1 className="text-2xl font-semibold">{hospitalName}</h1>
      </header>

      <main className="flex flex-1 flex-col items-center gap-6 px-6 pt-4">
        <StatusBadge status={status} />

        <Waveform
          level={level}
          active={status === "connected"}
        />

        <p className="text-center text-sm text-muted-foreground">
          {status === "connected"
            ? "Capturing audio. Speak normally into the microphone."
            : status === "connecting"
              ? "Connecting to ambulance audio stream…"
              : status === "error"
                ? "Connection failed — check LiveKit and retry."
                : "Disconnected."}
        </p>

        <div className="flex w-full flex-1 flex-col gap-2 overflow-hidden rounded-2xl border border-border bg-card p-4">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Live transcript
          </span>

          <LiveTranscript transportId={transportId} />
        </div>
      </main>

      <footer className="px-6 pb-10 pt-4">
        <Button
          onClick={handleEnd}
          variant="destructive"
          className="h-16 min-h-14 w-full text-lg font-semibold"
        >
          End transport
        </Button>
      </footer>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: Status;
}) {
  const color =
    status === "connected"
      ? "bg-success"
      : status === "connecting"
        ? "bg-warning"
        : "bg-destructive";

  return (
    <div className="flex items-center gap-2">
      <span className={`h-3 w-3 rounded-full ${color}`} />

      <span className="text-sm uppercase tracking-wide text-muted-foreground">
        {status}
      </span>
    </div>
  );
}

function Waveform({
  level,
  active,
}: {
  level: number;
  active: boolean;
}) {
  const bars = 24;

  return (
    <div className="flex h-24 items-center gap-1">
      {Array.from({ length: bars }).map((_, i) => {
        const jitter =
          0.6 + 0.4 * Math.abs(Math.sin(i * 12.9898));

        const amplitude = active
          ? Math.max(0.08, Math.min(1, level * jitter * 5))
          : 0.08;

        return (
          <div
            key={i}
            className="w-2 rounded-full bg-success transition-all duration-150"
            style={{
              height: `${amplitude * 100}%`,
            }}
          />
        );
      })}
    </div>
  );
}

function startLevelMeter(
  mediaStreamTrack: MediaStreamTrack,
  onLevel: (value: number) => void,
) {
  const AudioContextCtor =
    window.AudioContext ||
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;

  if (!AudioContextCtor) {
    console.warn("AudioContext is not supported.");
    return () => {};
  }

  const audioContext = new AudioContextCtor();

  const stream = new MediaStream([
    mediaStreamTrack,
  ]);

  const source =
    audioContext.createMediaStreamSource(stream);

  const analyser = audioContext.createAnalyser();

  analyser.fftSize = 512;

  source.connect(analyser);

  const data = new Uint8Array(
    analyser.frequencyBinCount,
  );

  let raf = 0;

  function tick() {
    analyser.getByteTimeDomainData(data);

    let sum = 0;

    for (const value of data) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }

    const rms = Math.sqrt(
      sum / data.length,
    );

    onLevel(rms);

    raf = requestAnimationFrame(tick);
  }

  tick();

  return () => {
    cancelAnimationFrame(raf);

    try {
      source.disconnect();
    } catch {
      // already disconnected
    }

    if (audioContext.state !== "closed") {
      void audioContext.close();
    }
  };
}