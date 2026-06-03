"use client";

import { useEffect, useRef, useState } from "react";

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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
const POLL_URL = `${API_BASE}/api/telemetry`;
const POLL_INTERVAL = 1500;

export function useWebSocket(_url?: string) {
  const [data, setData] = useState<Telemetry | null>(null);
  const [connected, setConnected] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let stopped = false;

    async function poll() {
      try {
        const res = await fetch(POLL_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!stopped) {
          setData(json);
          setConnected(true);
        }
      } catch {
        if (!stopped) setConnected(false);
      }
      if (!stopped) {
        timerRef.current = setTimeout(poll, POLL_INTERVAL);
      }
    }

    poll();

    return () => {
      stopped = true;
      clearTimeout(timerRef.current);
    };
  }, []);

  return { data, connected };
}
