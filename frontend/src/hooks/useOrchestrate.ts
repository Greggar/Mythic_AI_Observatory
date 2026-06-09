"use client";

import { useCallback, useRef, useState } from "react";
import type { TraceSession } from "@/types/trace";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const POLL_INTERVAL = 1500;

export function useOrchestrate() {
  const [trace, setTrace] = useState<TraceSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const submit = useCallback(async (prompt: string) => {
    setLoading(true);
    setError(null);
    setTrace(null);
    stopPolling();

    try {
      const res = await fetch(`${API_BASE}/api/orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        throw new Error(`Server responded ${res.status}`);
      }

      const { trace_id } = await res.json();

      // Poll for the trace until complete
      const poll = async () => {
        try {
          const pollRes = await fetch(`${API_BASE}/api/traces/${trace_id}`);
          if (pollRes.ok) {
            const data: TraceSession = await pollRes.json();
            setTrace(data);
            if (data.status === "complete" || data.status === "error") {
              setLoading(false);
              return; // stop polling
            }
          }
        } catch {
          // keep polling
        }
        pollTimer.current = setTimeout(poll, POLL_INTERVAL);
      };

      poll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }, [stopPolling]);

  return { trace, loading, error, submit };
}
