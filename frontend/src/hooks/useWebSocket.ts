"use client";

import { useMemo } from "react";
import { apiGet } from "@/lib/api";
import { usePoll } from "@/lib/usePoll";

export interface Telemetry {
  timestamp: string;
  hostname: string;
  cpu: { percent: number };
  memory: { percent: number };
  gpu: { gpu_util: number; gpu_mem_pct: number };
  ollama: { status: string; count: number };
  openclaw: { status: string };
  remotes: { status: string; target: string }[];
}

export function useWebSocket(_url?: string) {
  const { data, error } = usePoll<Telemetry>(
    () => apiGet<Telemetry>("/api/telemetry"),
    1500,
    { pauseOnHidden: true },
  );

  // Successfully received at least one payload and the most recent poll did
  // not fail — mirrors the old connected/disconnected boolean.
  const connected = useMemo(() => data !== null && !error, [data, error]);

  return { data, connected };
}