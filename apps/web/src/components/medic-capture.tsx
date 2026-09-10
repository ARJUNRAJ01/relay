"use client";

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, ConnectionState, LocalAudioTrack } from "livekit-client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const room = new Room();
    roomRef.current = room;

    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (cancelled) return;
      if (state === ConnectionState.Connected) setStatus("connected");
      else if (state === ConnectionState.Disconnected) setStatus("disconnected");
      else if (state === ConnectionState.Reconnecting) setStatus("connecting");
    });

    async function connect() {
      try {
        const res = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transportId }),
        });
        if (!res.ok) throw new Error(await res.text());
        const { token } = await res.json();

        await room.connect(env.NEXT_PUBLIC_LIVEKIT_URL, token);
        await room.localParticipant.setMicrophoneEnabled(true);
        if (cancelled) return;
        setStatus("connected");

        const micPublication = Array.from(room.localParticipant.trackPublications.values()).find(
          (p) => p.track instanceof LocalAudioTrack,
        );
        const track = micPublication?.track;
        if (track && track.mediaStreamTrack) {
          startLevelMeter(track.mediaStreamTrack, (v) => !cancelled && setLevel(v));
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setStatus("error");
          toast.error("Could not connect to the transport room.");
        }
      }
    }

    connect();

    return () => {
      cancelled = true;
      room.disconnect();
    };
  }, [transportId]);

  async function handleEnd() {
    await roomRef.current?.disconnect();
    await endTransport(transportId);
    router.push("/medic");
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-50">
      <header className="flex flex-col gap-1 px-6 pb-4 pt-8">
        <span className="text-sm text-zinc-500">En route to</span>
        <h1 className="text-2xl font-semibold">{hospitalName}</h1>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <StatusBadge status={status} />
        <Waveform level={level} active={status === "connected"} />
        <p className="text-center text-sm text-zinc-500">
          {status === "connected"
            ? "Capturing audio. This device stays awake for the run."
            : status === "connecting"
              ? "Connecting…"
              : status === "error"
                ? "Connection failed — check signal and retry."
                : "Disconnected."}
        </p>
      </main>

      <footer className="px-6 pb-10 pt-4">
        <Button
          onClick={handleEnd}
          variant="destructive"
          className="h-16 w-full text-lg font-semibold"
        >
          End transport
        </Button>
      </footer>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const color =
    status === "connected"
      ? "bg-emerald-500"
      : status === "connecting"
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <span className={`h-3 w-3 rounded-full ${color}`} />
      <span className="text-sm uppercase tracking-wide text-zinc-400">{status}</span>
    </div>
  );
}

function Waveform({ level, active }: { level: number; active: boolean }) {
  const bars = 24;
  return (
    <div className="flex h-24 items-center gap-1">
      {Array.from({ length: bars }).map((_, i) => {
        // Deterministic per-bar jitter (no Math.random — must stay pure for render)
        // so bars vary in height without every bar being identical.
        const jitter = 0.6 + 0.4 * Math.abs(Math.sin(i * 12.9898));
        const amplitude = active ? Math.max(0.08, Math.min(1, level * jitter)) : 0.08;
        return (
          <div
            key={i}
            className="w-2 rounded-full bg-emerald-400 transition-all duration-150"
            style={{ height: `${amplitude * 100}%` }}
          />
        );
      })}
    </div>
  );
}

function startLevelMeter(mediaStreamTrack: MediaStreamTrack, onLevel: (v: number) => void) {
  const AudioContextCtor = window.AudioContext;
  const audioContext = new AudioContextCtor();
  const source = audioContext.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  let raf = 0;
  function tick() {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) {
      const centered = (v - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / data.length);
    onLevel(rms);
    raf = requestAnimationFrame(tick);
  }
  tick();

  return () => {
    cancelAnimationFrame(raf);
    audioContext.close();
  };
}
