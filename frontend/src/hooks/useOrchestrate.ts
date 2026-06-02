"use client";

import { useCallback, useState } from "react";
import type { TraceSession } from "@/types/trace";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export function useOrchestrate() {
  const [trace, setTrace] = useState<TraceSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (prompt: string) => {
    setLoading(true);
    setError(null);
    setTrace(null);

    try {
      const res = await fetch(`${API_BASE}/api/orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        throw new Error(`Server responded ${res.status}`);
      }

      const data: TraceSession = await res.json();
      setTrace(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  return { trace, loading, error, submit };
}
