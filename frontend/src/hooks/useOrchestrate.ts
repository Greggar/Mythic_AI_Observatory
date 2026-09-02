"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TraceSession } from "@/types/trace";
import { apiGet, apiPost } from "@/lib/api";
import { pollUntil, type PollHandle } from "@/lib/usePoll";

export function useOrchestrate() {
  const [trace, setTrace] = useState<TraceSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<PollHandle<TraceSession> | null>(null);

  const stopPolling = useCallback(() => {
    pollRef.current?.stop();
    pollRef.current = null;
  }, []);

  // Abort any in-flight poll when the hook unmounts.
  useEffect(() => stopPolling, [stopPolling]);

  const submit = useCallback(
    async (prompt: string) => {
      setLoading(true);
      setError(null);
      setTrace(null);
      stopPolling();

      try {
        const { trace_id } = await apiPost<{ trace_id: string }>("/api/orchestrate", {
          prompt,
        });

        const handle = pollUntil<TraceSession>(
          () => apiGet<TraceSession>(`/api/traces/${trace_id}`),
          (d) => d.status === "complete" || d.status === "error",
          {
            onTick: (d) => setTrace(d),
          },
        );
        pollRef.current = handle;
        handle.promise
          .then(() => setLoading(false))
          .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === "AbortError") {
              // stopped by unmount/reset — not an error
            } else {
              setError(err instanceof Error ? err.message : "Unknown error");
            }
            setLoading(false);
          });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      }
    },
    [stopPolling],
  );

  return { trace, loading, error, submit };
}