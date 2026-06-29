"use client";

import { useEffect, useState, useRef } from "react";
import { Clock4 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

const STAGES = [
  "Request Received",
  "Intent Classification",
  "Model Routing",
  "Memory Retrieval",
  "Context Assembly",
  "Response Generation",
  "Output Packaging",
];

const STAGE_COLORS = [
  "bg-zinc-500",
  "bg-red-500",
  "bg-blue-500",
  "bg-purple-500",
  "bg-orange-500",
  "bg-teal-500",
  "bg-zinc-400",
];

function fmt(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function LatencyBreakdown({ refreshTrigger = 0, traceSteps }: { refreshTrigger?: number; traceSteps?: Array<{ label: string; duration_ms: number | null }> }) {
  const [averages, setAverages] = useState<number[]>(STAGES.map(() => 0));
  const [total, setTotal] = useState(0);
  const [count, setCount] = useState(0);
  const [hasData, setHasData] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/traces?limit=50`);
      if (!res.ok) return;
      const traces = await res.json();
      if (!traces || traces.length === 0) return;

      const sums = STAGES.map(() => 0);
      let n = 0;
      for (const t of traces) {
        for (const step of t.steps || []) {
          const idx = STAGES.indexOf(step.label);
          if (idx !== -1 && step.duration_ms != null) {
            sums[idx] += step.duration_ms;
          }
        }
        n++;
      }
      const avgs = sums.map((s) => (n > 0 ? s / n : 0));
      setAverages(avgs);
      setTotal(avgs.reduce((a, b) => a + b, 0));
      setCount(n);
      setHasData(true);
    } catch {
      // silently retry on next interval
    }
  };

  useEffect(() => {
    if (refreshTrigger > 0) {
      fetchData();
      if (!intervalRef.current) {
        intervalRef.current = setInterval(fetchData, 5000);
      }
    }
    return () => {
      if (refreshTrigger === 0 && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [refreshTrigger]);

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex flex-col items-center gap-1.5 text-teal-mystic">
        <Clock4 size={16} />
        <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
          Step Latency
        </span>
      </div>

      {!hasData ? (
        <div className="text-[10px] text-zinc-600 text-center py-4 font-mono">
          No trace data yet
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
              {STAGES.map((label, i) => {
              const maxAvg = Math.max(...averages, 1);
              const pct = maxAvg > 0 ? (averages[i] / maxAvg) * 100 : 0;
              const liveStep = traceSteps?.find((s) => s.label === label && s.duration_ms != null);
              const liveMs = liveStep?.duration_ms ?? undefined;
              const livePct = liveMs != null && maxAvg > 0 ? (liveMs / maxAvg) * 100 : 0;
              return (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-[9px] w-[88px] shrink-0 truncate font-mono tracking-tight flex items-center gap-1"
                    style={{ color: liveMs != null ? "rgba(212, 212, 216, 0.7)" : "rgba(113, 113, 122, 1)" }}>
                    {liveMs != null && <span className="w-1 h-1 rounded-full bg-teal-mystic shrink-0" />}
                    <span className="truncate">{label}</span>
                  </span>
                  <div className="flex-1 h-3 rounded-full bg-white/[0.04] overflow-hidden relative">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${STAGE_COLORS[i]}`}
                      style={{ width: `${Math.max(pct, 1)}%`, opacity: 0.35 }}
                    />
                    {liveMs != null && (
                      <div
                        className={`absolute top-0 left-0 h-full rounded-full transition-all duration-300 ${STAGE_COLORS[i]}`}
                        style={{
                          width: `${Math.max(livePct, 1)}%`,
                          opacity: 0.95,
                          backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 100%)`,
                          borderRight: "1.5px solid rgba(255,255,255,0.5)",
                        }}
                      />
                    )}
                  </div>
                  <span className="text-[10px] font-mono w-14 text-right shrink-0"
                    style={{ color: liveMs != null ? "rgba(212, 212, 216, 0.8)" : "rgba(161, 161, 170, 0.6)" }}>
                    {liveMs != null ? fmt(liveMs) : fmt(averages[i])}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="pt-2 mt-1 border-t border-white/[0.04] flex items-center justify-between">
            <span className="text-[9px] font-mono text-zinc-600">Total avg ({count} traces)</span>
            <span className="text-xs font-mono text-zinc-300">{fmt(total)}</span>
          </div>
        </>
      )}
    </div>
  );
}
