"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

function downloadCSV(url: string, filename: string) {
  fetch(url)
    .then((r) => r.blob())
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch(() => {});
}

interface ModelProfileData {
  model: string;
  trace_count: number;
  avg_latency_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  avg_eval_count: number | null;
  failure_rate: number;
  avg_confidence: number | null;
  stage_avgs: Record<string, number>;
  avg_steps: number;
  verbosity_score: number;
  avg_output_tokens: number;
  formatting_bullet_pct: number;
  formatting_table_pct: number;
  formatting_code_pct: number;
  formatting_prose_pct: number;
  hedging_freq: number;
  lexical_diversity: number;
  directness_score: number;
  avg_token_entropy?: number | null;
  p95_token_entropy?: number | null;
  avg_surprisal?: number | null;
  entropy_trace_count?: number;
}

function shortModel(name: string): string {
  if (name.includes("/")) {
    const parts = name.split("/");
    return parts[parts.length - 1].replace(/-UD-Q.*/, "").replace(/:.*/, "");
  }
  return name.slice(0, 24);
}

function formatMs(ms: number): string {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
}

function Slider({ value, leftLabel, rightLabel, color }: { value: number; leftLabel: string; rightLabel: string; color?: string }) {
  const pct = Math.max(0, Math.min(value, 1)) * 100;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[7px] font-mono text-zinc-600">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden relative">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: color || "linear-gradient(90deg, oklch(62% 0.16 145), oklch(78% 0.14 85))",
            opacity: 0.7,
          }}
        />
      </div>
    </div>
  );
}

function FormatDonut({ bullet, table, code, prose }: { bullet: number; table: number; code: number; prose: number }) {
  const R = 14;
  const circ = 2 * Math.PI * R;
  const segments = [
    { pct: prose, label: "Prose", color: "oklch(65% 0.1 260)" },
    { pct: bullet, label: "Bullet", color: "oklch(65% 0.18 145)" },
    { pct: table, label: "Table", color: "oklch(70% 0.2 85)" },
    { pct: code, label: "Code", color: "oklch(60% 0.15 320)" },
  ].filter((s) => s.pct > 0);
  let offset = 0;
  return (
    <div className="flex items-center gap-2">
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
        {segments.map((seg) => {
          const len = seg.pct * circ;
          const dash = `${len} ${circ - len}`;
          const el = (
            <circle
              key={seg.label}
              cx="20" cy="20" r={R}
              fill="none"
              stroke={seg.color}
              strokeWidth="4"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              transform="rotate(-90 20 20)"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1">
            <span className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-[7px] font-mono text-zinc-500">{seg.label} {(seg.pct * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HedgeGauge({ freq }: { freq: number }) {
  const level = freq < 2 ? "Low" : freq < 6 ? "Medium" : "High";
  const color = freq < 2 ? "oklch(65% 0.18 145)" : freq < 6 ? "oklch(78% 0.14 85)" : "oklch(55% 0.22 30)";
  const pct = Math.min(freq / 12, 1) * 100;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[7px] font-mono text-zinc-600">
        <span>Low Caution</span>
        <span>High Caution</span>
      </div>
      <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden relative">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.7 }} />
      </div>
      <div className="text-[8px] font-mono text-zinc-500 text-center">
        Risk Profile: <span style={{ color }}>{level}</span> ({freq.toFixed(1)}/1K chars)
      </div>
    </div>
  );
}

const stageColors: Record<string, string> = {
  "step-1": "oklch(65% 0.18 210)",
  "step-2": "oklch(65% 0.20 265)",
  "step-3": "oklch(60% 0.15 190)",
  "step-4": "oklch(62% 0.16 145)",
  "step-5": "oklch(68% 0.18 85)",
  "step-6": "oklch(70% 0.20 45)",
  "step-7": "oklch(65% 0.15 320)",
};

const stageLabels: Record<string, string> = {
  "step-1": "Request",
  "step-2": "Intent",
  "step-3": "Agent",
  "step-4": "Memory",
  "step-5": "Context",
  "step-6": "Generate",
  "step-7": "Final",
};

export default function PersonalityProfile() {
  const [profiles, setProfiles] = useState<ModelProfileData[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showPerf, setShowPerf] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchProfiles = () => {
    fetch(`${API_BASE}/api/traces/profile`)
      .then((r) => r.json())
      .then((data) => setProfiles(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchProfiles();
    pollRef.current = setInterval(fetchProfiles, 30000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (!pollRef.current) {
          fetchProfiles();
          pollRef.current = setInterval(fetchProfiles, 30000);
        }
      } else {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const maxLatency = useMemo(
    () => Math.max(...profiles.map((p) => p.avg_latency_ms), 1),
    [profiles]
  );

  if (profiles.length === 0) return null;

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex flex-col items-center gap-1.5 text-teal-mystic">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="8" r="4" />
          <path d="M20 21a8 8 0 10-16 0" />
        </svg>
        <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
          Personality Profiles
        </span>
        <p className="text-[8px] font-mono text-zinc-600 leading-relaxed text-center max-w-[260px]">
          Linguistic style and cognitive fingerprints computed per model from completed trace outputs.
        </p>
        <button
          onClick={() => downloadCSV(`${API_BASE}/api/export/profiles.csv`, "profiles.csv")}
          className="text-[7px] font-mono tracking-wider text-zinc-600 hover:text-teal-mystic/70 transition-colors"
          title="Download profiles as CSV"
        >
          [ export .csv ]
        </button>
      </div>

      <div className="space-y-2">
        {profiles.map((p, pi) => {
          const isOpen = expanded === pi;
          const showPerfForThis = showPerf === pi;
          const failurePct = p.failure_rate * 100;
          return (
            <div key={p.model} className="bg-white/[0.03] rounded-md overflow-hidden">
              {/* Header */}
              <button
                onClick={() => {
                  setExpanded(isOpen ? null : pi);
                  if (isOpen) setShowPerf(null);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-white/[0.04] transition-colors text-left"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-teal-mystic/40 shrink-0" />
                <span className="text-[10px] font-mono text-zinc-200 truncate flex-1">
                  {shortModel(p.model)}
                </span>
                <span className="text-[8px] font-mono text-zinc-500">{p.trace_count} traces</span>
                <svg
                  className={`shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>

              {isOpen && (
                <div className="px-2.5 pb-2 space-y-3">
                  {/* Personality metrics */}
                  <div>
                    <div className="text-[8px] font-mono tracking-wider text-zinc-600 uppercase mb-2">
                      Linguistic Style
                    </div>

                    <div className="space-y-2">
                      {/* Verbosity */}
                      <div>
                        <div className="flex justify-between text-[8px] font-mono text-zinc-500 mb-1">
                          <span>Verbosity</span>
                          <span>{p.avg_output_tokens.toFixed(0)} tok/response</span>
                        </div>
                        <Slider value={p.verbosity_score} leftLabel="Laconic" rightLabel="Prolix" />
                      </div>

                      {/* Directness */}
                      <div>
                        <div className="text-[8px] font-mono text-zinc-500 mb-1">Directness</div>
                        <Slider value={1 - p.directness_score} leftLabel="Blunt" rightLabel="Discursive" color="oklch(65% 0.2 265)" />
                      </div>

                      {/* Formatting DNA */}
                      <div>
                        <div className="text-[8px] font-mono text-zinc-500 mb-1">Formatting DNA</div>
                        <FormatDonut
                          bullet={p.formatting_bullet_pct}
                          table={p.formatting_table_pct}
                          code={p.formatting_code_pct}
                          prose={p.formatting_prose_pct}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Cognitive Fingerprint */}
                  <div className="border-t border-white/[0.06] pt-2">
                    <div className="text-[8px] font-mono tracking-wider text-zinc-600 uppercase mb-2">
                      Cognitive Fingerprint
                    </div>
                    <div className="space-y-2">
                      {/* Hedging */}
                      <HedgeGauge freq={p.hedging_freq} />

                      {/* Lexical Diversity */}
                      <div>
                        <div className="flex justify-between text-[8px] font-mono text-zinc-500 mb-1">
                          <span>Lexical Diversity</span>
                          <span>{p.lexical_diversity.toFixed(2)} TTR</span>
                        </div>
                        <Slider value={p.lexical_diversity} leftLabel="Limited" rightLabel="Rich" color="oklch(65% 0.2 320)" />
                      </div>

                      {/* Token Uncertainty / Decisiveness */}
                      {p.avg_token_entropy != null && (
                        <div>
                          <div className="flex justify-between text-[8px] font-mono text-zinc-500 mb-1">
                            <span>Decisiveness</span>
                            <span className="text-violet-400">
                              {p.avg_token_entropy.toFixed(2)} bits/tok
                            </span>
                          </div>
                          <Slider
                            value={Math.min(1, p.avg_token_entropy / 3)}
                            leftLabel="Decisive"
                            rightLabel="Uncertain"
                            color="oklch(70% 0.18 300)"
                          />
                          <div className="text-[7px] font-mono text-zinc-600 mt-0.5">
                            p95 {p.p95_token_entropy?.toFixed(2) ?? "—"} · surprisal{" "}
                            {p.avg_surprisal?.toFixed(2) ?? "—"} · {p.entropy_trace_count ?? 0} traces
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Performance — collapsible */}
                  <div className="border-t border-white/[0.06] pt-1">
                    <button
                      onClick={() => setShowPerf(showPerfForThis ? null : pi)}
                      className="w-full flex items-center gap-1.5 py-1 text-[8px] font-mono tracking-wider text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                      <svg
                        className={`transition-transform ${showPerfForThis ? "rotate-90" : ""}`}
                        width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                      Performance &amp; Latency
                    </button>

                    {showPerfForThis && (
                      <div className="space-y-2 pt-1">
                        {/* Quick stats row */}
                        <div className="grid grid-cols-4 gap-1">
                          <div className="text-center">
                            <div className="text-[7px] font-mono text-zinc-600 uppercase">Latency</div>
                            <div className="text-[10px] font-mono text-zinc-300">{formatMs(p.avg_latency_ms)}</div>
                          </div>
                          <div className="text-center">
                            <div className="text-[7px] font-mono text-zinc-600 uppercase">Failures</div>
                            <div className={`text-[10px] font-mono ${failurePct > 10 ? "text-[oklch(55%_0.22_30)]" : "text-zinc-300"}`}>
                              {failurePct.toFixed(1)}%
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-[7px] font-mono text-zinc-600 uppercase">Tokens</div>
                            <div className="text-[10px] font-mono text-zinc-300">
                              {p.avg_eval_count != null ? `${Math.round(p.avg_eval_count)}` : "—"}
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-[7px] font-mono text-zinc-600 uppercase">Confidence</div>
                            <div className="text-[10px] font-mono text-zinc-300">
                              {p.avg_confidence != null ? `${(p.avg_confidence * 100).toFixed(0)}%` : "—"}
                            </div>
                          </div>
                        </div>

                        {/* Latency bars */}
                        <div>
                          <div className="flex items-center gap-1 mb-1">
                            <span className="text-[7px] font-mono text-zinc-600 w-8">avg</span>
                            <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${(p.avg_latency_ms / maxLatency) * 100}%`,
                                  background: "linear-gradient(90deg, oklch(62% 0.16 145), oklch(78% 0.14 85))",
                                }}
                              />
                            </div>
                            <span className="text-[7px] font-mono text-zinc-500 w-10 text-right">{formatMs(p.avg_latency_ms)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[7px] font-mono text-zinc-600 w-8">p95</span>
                            <div className="flex-1 h-1 bg-white/[0.04] rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.min((p.p95_latency_ms / maxLatency) * 100, 100)}%`,
                                  background: "linear-gradient(90deg, oklch(55% 0.22 30/0.5), oklch(55% 0.22 30))",
                                }}
                              />
                            </div>
                            <span className="text-[7px] font-mono text-zinc-500 w-10 text-right">{formatMs(p.p95_latency_ms)}</span>
                          </div>
                        </div>

                        {/* Stage breakdown */}
                        <div className="space-y-1">
                          <div className="text-[8px] font-mono tracking-wider text-zinc-600 uppercase">
                            Per-Stage Avg Latency
                          </div>
                          {Object.entries(p.stage_avgs)
                            .filter(([, d]) => d > 0)
                            .sort(([, a], [, b]) => b - a)
                            .map(([sid, dur]) => {
                              const stagePct = p.avg_latency_ms > 0 ? (dur / p.avg_latency_ms) * 100 : 0;
                              return (
                                <div key={sid} className="flex items-center gap-1.5">
                                  <span className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: stageColors[sid] || "oklch(62% 0.1 200)" }} />
                                  <span className="text-[9px] text-zinc-400 w-12">{stageLabels[sid] || sid}</span>
                                  <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(stagePct, 100)}%`, backgroundColor: stageColors[sid] || "oklch(62% 0.1 200)", opacity: 0.5 + 0.5 * (stagePct / 100) }} />
                                  </div>
                                  <span className="text-[8px] font-mono text-zinc-500 w-14 text-right">{formatMs(dur)}</span>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
