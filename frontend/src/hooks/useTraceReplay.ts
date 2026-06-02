"use client";

import { useEffect, useState } from "react";
import type { TraceSession } from "@/types/trace";

export function useTraceReplay(trace: TraceSession | null) {
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "replaying" | "complete">("idle");

  useEffect(() => {
    if (!trace) {
      setActiveStepIndex(null);
      setPhase("idle");
      return;
    }

    setPhase("replaying");
    setActiveStepIndex(-1);

    let cancelled = false;
    let stepIndex = -1;

    const play = () => {
      if (cancelled) return;
      stepIndex++;
      if (stepIndex >= trace.steps.length) {
        setPhase("complete");
        return;
      }
      setActiveStepIndex(stepIndex);
      const ms = trace.steps[stepIndex].duration_ms ?? 300;
      setTimeout(play, Math.max(ms, 600));
    };

    // initial delay before first step
    const start = setTimeout(play, 400);

    return () => {
      cancelled = true;
      clearTimeout(start);
      setPhase("idle");
    };
  }, [trace]);

  return { activeStepIndex, phase };
}
