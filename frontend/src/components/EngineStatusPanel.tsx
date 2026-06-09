"use client";

import { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const MAX_BARS = 16;

interface TelemetryRemote {
  status: string;
  target: string;
  detail?: string;
}

interface Telemetry {
  ollama: { status: string; count: number };
  openclaw: { status: string };
  remotes: TelemetryRemote[];
}

interface Props {
  telemetry: Telemetry | null;
}

interface TraceEntry {
  id: string;
  prompt?: string;
  status: string;
  steps: { duration_ms: number | null }[];
}

interface StatusDetail {
  name: string;
  status: string;
  target?: string;
}

export default function EngineStatusPanel({ telemetry }: Props) {
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [hoveredMetric, setHoveredMetric] = useState<string | null>(null);
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/traces?limit=40`)
      .then((r) => r.json())
      .then(setTraces)
      .catch(() => {});
  }, []);

  const metrics = useMemo(() => {
    const completed = traces.filter((t) => t.status === "complete");
    const counts = traces.length;
    const durations = completed.map((t) =>
      t.steps.reduce((s, st) => s + (st.duration_ms || 0), 0)
    );

    const avgDuration = durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
    const minDuration = durations.length ? Math.min(...durations) : 0;
    const maxDuration = durations.length ? Math.max(...durations) : 0;

    const recentBars = completed
      .slice(-MAX_BARS)
      .map((t) => ({
        ms: t.steps.reduce((s, st) => s + (st.duration_ms || 0), 0),
        id: t.id.slice(0, 8),
        prompt: (t.prompt || "").slice(0, 60),
      }));
    const maxBar = recentBars.length
      ? Math.max(...recentBars.map((b) => b.ms), 1)
      : 1;

    // Health counts + details from telemetry
    let ok = 0;
    let err = 0;
    let off = 0;
    let unknown = 0;
    const problemDetails: StatusDetail[] = [];
    if (telemetry) {
      const tally = (name: string, status: string, target?: string, detail?: string) => {
        if (status === "ok") ok++;
        else if (status === "error") {
          if (detail === "connection_refused") {
            off++; problemDetails.push({ name, status: "stopped", target });
          } else {
            err++; problemDetails.push({ name, status: "error", target });
          }
        }
        else if (status === "disabled") { off++; problemDetails.push({ name, status: "disabled", target }); }
        else unknown++;
      };
      tally("Ollama", telemetry.ollama?.status || "unknown");
      tally("OpenClaw", telemetry.openclaw?.status || "unknown");
      for (const r of telemetry.remotes || []) tally(r.target, r.status, r.target, r.detail);
    }

    return { counts, avgDuration, minDuration, maxDuration, recentBars, maxBar, ok, err, off, unknown, problemDetails };
  }, [traces, telemetry]);

  const totalServices = metrics.ok + metrics.err + metrics.off + metrics.unknown;

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex flex-col items-center gap-1.5 text-teal-mystic">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
        <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
          Runtime Metrics
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white/[0.03] rounded p-2 text-center">
          <div className="text-[8px] font-mono tracking-wider text-zinc-600 uppercase mb-1">
            Throughput
          </div>
          <div className="text-sm font-mono text-zinc-200">
            {metrics.counts}
            <span className="text-[9px] text-zinc-600 ml-0.5">total</span>
          </div>
        </div>
        <div className="bg-white/[0.03] rounded p-2 text-center">
          <div className="text-[8px] font-mono tracking-wider text-zinc-600 uppercase mb-1">
            Latency
          </div>
          <div className="text-sm font-mono text-zinc-200">
            {metrics.avgDuration > 0
              ? `${(metrics.avgDuration / 1000).toFixed(1)}s`
              : "—"}
          </div>
        </div>
        <div
          className="bg-white/[0.03] rounded p-2 text-center relative"
          onMouseEnter={() => setHoveredMetric("errors")}
          onMouseLeave={() => setHoveredMetric(null)}
        >
          <div className="text-[8px] font-mono tracking-wider text-zinc-600 uppercase mb-1">
            Issues
          </div>
          <div className={`text-sm font-mono ${metrics.err + metrics.off > 0 ? "text-[oklch(55%_0.22_30)]" : "text-zinc-600"}`}>
            {metrics.err + metrics.off}
          </div>
          {hoveredMetric === "errors" && metrics.problemDetails.length > 0 && (
            <div className="absolute z-20 top-full mt-1.5 left-1/2 -translate-x-1/2 w-44
              bg-[rgba(6,20,35,0.96)] border border-white/[0.1] rounded-md px-2.5 py-1.5 shadow-xl text-left">
              <div className="text-[9px] font-mono tracking-wider text-zinc-500 uppercase mb-1">Issues</div>
              {metrics.problemDetails.map((d) => {
                const isErr = d.status === "error";
                const isStopped = d.status === "stopped";
                const dotColor = isErr ? "bg-[oklch(55%_0.22_30)]" : isStopped ? "bg-[oklch(78%_0.14_85)]" : "bg-zinc-600";
                const labelColor = isErr ? "text-[oklch(55%_0.22_30/0.7)]" : isStopped ? "text-[oklch(78%_0.14_85/0.7)]" : "text-zinc-500";
                const displayLabel = isErr ? "error" : isStopped ? "stopped" : d.status;
                return (
                  <div key={d.name} className="flex items-center gap-1.5 py-0.5">
                    <span className={`w-1 h-1 rounded-full shrink-0 ${dotColor}`} />
                    <span className="text-[10px] text-zinc-300">{d.name}</span>
                    <span className={`text-[8px] font-mono ml-auto ${labelColor}`}>{displayLabel}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Mini duration bars */}
      {metrics.recentBars.length > 0 && (
        <div>
          <div className="text-[8px] font-mono tracking-wider text-zinc-600 uppercase mb-1">
            Recent Durations
          </div>
          <div className="flex items-end gap-[2px] h-8 relative">
            {metrics.recentBars.map((b, i) => {
              const pct = (b.ms / metrics.maxBar) * 100;
              return (
                <div
                  key={i}
                  className="flex-1 rounded-t transition-all duration-300 relative"
                  style={{ height: `${Math.max(pct, 4)}%` }}
                  onMouseEnter={() => setHoveredBar(i)}
                  onMouseLeave={() => setHoveredBar(null)}
                >
                  <div
                    className="absolute inset-0 rounded-t"
                    style={{
                      background: `linear-gradient(to top, oklch(62% 0.16 145), oklch(78% 0.14 85))`,
                      opacity: 0.3 + 0.7 * (pct / 100),
                    }}
                  />
                  {hoveredBar === i && (
                    <div className="absolute z-20 bottom-full mb-1.5 left-1/2 -translate-x-1/2 w-44
                      bg-[rgba(6,20,35,0.96)] border border-white/[0.1] rounded-md px-2.5 py-1.5 shadow-xl">
                      <div className="text-[9px] font-mono text-teal-mystic/70">{b.id}</div>
                      <div className="text-[9px] text-zinc-300 mt-0.5 leading-tight line-clamp-2">{b.prompt || "—"}</div>
                      <div className="text-[8px] font-mono text-zinc-500 mt-1">{(b.ms / 1000).toFixed(1)}s</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {totalServices === 0 && (
        <div className="text-[10px] text-zinc-600 text-center py-1 font-mono">Waiting for data…</div>
      )}
    </div>
  );
}
