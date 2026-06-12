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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const POLL_URL = `${API_BASE}/api/telemetry`;
const POLL_INTERVAL = 1500;

export function useWebSocket(_url?: string) {
  const [data, setData] = useState<Telemetry | null>(null);
  const [connected, setConnected] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stoppedRef = useRef(false);

  async function pollOnce() {
    try {
      const res = await fetch(POLL_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!stoppedRef.current) {
        setData(json);
        setConnected(true);
      }
    } catch {
      if (!stoppedRef.current) setConnected(false);
    }
  }

  function schedule() {
    timerRef.current = setTimeout(async () => {
      if (stoppedRef.current) return;
      await pollOnce();
      if (!stoppedRef.current) schedule();
    }, POLL_INTERVAL);
  }

  useEffect(() => {
    stoppedRef.current = false;
    pollOnce();
    schedule();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        pollOnce();
        schedule();
      } else {
        if (timerRef.current) clearTimeout(timerRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stoppedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { data, connected };
}
