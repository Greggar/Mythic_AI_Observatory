"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { apiGet } from "@/lib/api";

interface ReasoningVariantStat {
  n: number;
  accuracy: number | null;
  entropy_mean: number | null;
  median_branching: number | null;
  ddc_margin: number | null;
}

interface ReasoningRow {
  model: string;
  base: ReasoningVariantStat | null;
  symbolic: ReasoningVariantStat | null;
  noop: ReasoningVariantStat | null;
  drop_symbolic: number | null;
  drop_noop: number | null;
}

interface ReasoningSummary {
  rows?: ReasoningRow[];
  narrative?: string;
  status?: string;
}

interface ComplexityModelStat {
  n: number;
  accuracy: number | null;
  mean_tokens: number | null;
  mean_entropy: number | null;
  mean_branching: number | null;
  efficiency_ratio: number | null;
}

interface ComplexityLevel {
  complexity: number;
  optimal_tokens: number;
  models: Record<string, ComplexityModelStat>;
}

interface ComplexitySummary {
  generators?: Record<string, ComplexityLevel[]>;
  narrative?: string;
  status?: string;
}

interface ProbeBaseline {
  type: "reasoning" | "complexity";
  run_at: string;
  model: string;
  provider: string;
  seed: number;
  run_id: string;
  total: number;
  completed: number;
  failed: number;
  summary?: ReasoningSummary | ComplexitySummary;
}

type Filter = "all" | "reasoning" | "complexity";

const ACC_COLOR = (acc: number | null | undefined) => {
  if (acc == null) return "var(--color-zinc-600)";
  if (acc >= 0.8) return "#34d399";
  if (acc >= 0.5) return "#fbbf24";
  return "#f87171";
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortModel(model: string): string {
  return model.includes("/") ? model.split("/").pop()! : model;
}

function ReasoningRecord({ record }: { record: ProbeBaseline }) {
  const summary = record.summary as ReasoningSummary | undefined;
  const [open, setOpen] = useState(false);
  const row = summary?.rows?.[0];

  const baseAcc = row?.base?.accuracy ?? null;
  const symAcc = row?.symbolic?.accuracy ?? null;
  const noopAcc = row?.noop?.accuracy ?? null;
  const dropSym = row?.drop_symbolic ?? null;
  const dropNoop = row?.drop_noop ?? null;

  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        {open ? <ChevronDown size={11} className="text-zinc-600 shrink-0" /> : <ChevronRight size={11} className="text-zinc-600 shrink-0" />}
        <span className="text-[9px] font-mono tracking-wider uppercase text-zinc-500 shrink-0 w-[30px]">Reason</span>
        <span className="text-[10px] font-mono text-zinc-400 truncate">{shortModel(record.model)}</span>
        <span className="text-[9px] font-mono text-zinc-600 hidden sm:inline">seed {record.seed}</span>
        <span className="ml-auto shrink-0 flex items-center gap-2">
          <span className="text-[9px] font-mono text-zinc-600">{fmtTime(record.run_at)}</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: ACC_COLOR(baseAcc), background: "rgba(255,255,255,0.04)" }}>
            {row ? `${Math.round((baseAcc ?? 0) * 100)}%/${Math.round((symAcc ?? 0) * 100)}%/${Math.round((noopAcc ?? 0) * 100)}%` : "—"}
          </span>
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-white/[0.04]">
          <div className="pt-2 grid grid-cols-3 gap-3">
            {(["base", "symbolic", "noop"] as const).map((v) => {
              const stat = v === "base" ? row?.base : v === "symbolic" ? row?.symbolic : row?.noop;
              return (
                <div key={v} className="bg-white/[0.02] border border-white/[0.06] rounded-md p-2.5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[8px] font-mono tracking-wider uppercase text-zinc-500">{v}</span>
                    {v === "symbolic" && dropSym != null && dropSym > 0 && (
                      <span className="text-[8px] font-mono text-red-400">−{Math.round(dropSym * 100)}%</span>
                    )}
                    {v === "noop" && dropNoop != null && dropNoop > 0 && (
                      <span className="text-[8px] font-mono text-red-400">−{Math.round(dropNoop * 100)}%</span>
                    )}
                  </div>
                  <div className="text-[15px] font-mono font-semibold" style={{ color: ACC_COLOR(stat?.accuracy) }}>
                    {stat?.accuracy != null ? `${Math.round(stat.accuracy * 100)}%` : "—"}
                  </div>
                  {stat?.entropy_mean != null && (
                    <div className="text-[8px] font-mono text-zinc-600 mt-1">H {stat.entropy_mean.toFixed(3)} · 2^H {stat.median_branching?.toFixed(2) ?? "—"}</div>
                  )}
                  {stat?.ddc_margin != null && (
                    <div className="text-[8px] font-mono text-zinc-600">DDC margin {stat.ddc_margin.toFixed(3)}</div>
                  )}
                  {stat?.n != null && <div className="text-[8px] font-mono text-zinc-700">n={stat.n}</div>}
                </div>
              );
            })}
          </div>
          {summary?.narrative && (
            <div className="text-[9px] font-mono text-zinc-500 whitespace-pre-wrap leading-relaxed border-t border-white/[0.04] pt-2">
              {summary.narrative.split("\n\n").map((para, i) => (
                <p key={i} className="mb-1.5">{para}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ComplexityRecord({ record }: { record: ProbeBaseline }) {
  const summary = record.summary as ComplexitySummary | undefined;
  const [open, setOpen] = useState(false);
  const generators = summary?.generators ?? {};
  const genNames = Object.keys(generators);

  const accuracies: number[] = [];
  for (const levels of Object.values(generators)) {
    for (const lv of levels) {
      for (const ms of Object.values(lv.models)) {
        if (ms.accuracy != null) accuracies.push(ms.accuracy);
      }
    }
  }
  const meanAcc = accuracies.length ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length : null;

  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        {open ? <ChevronDown size={11} className="text-zinc-600 shrink-0" /> : <ChevronRight size={11} className="text-zinc-600 shrink-0" />}
        <span className="text-[9px] font-mono tracking-wider uppercase text-zinc-500 shrink-0 w-[30px]">Cplx</span>
        <span className="text-[10px] font-mono text-zinc-400 truncate">{shortModel(record.model)}</span>
        <span className="text-[9px] font-mono text-zinc-600 hidden sm:inline">seed {record.seed}</span>
        <span className="text-[9px] font-mono text-zinc-600 hidden md:inline">gen {genNames.map((g) => (g === "arithmetic_chain" ? "arith" : "hanoi")).join("+")}</span>
        <span className="ml-auto shrink-0 flex items-center gap-2">
          <span className="text-[9px] font-mono text-zinc-600">{fmtTime(record.run_at)}</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: ACC_COLOR(meanAcc), background: "rgba(255,255,255,0.04)" }}>
            {meanAcc != null ? `${Math.round(meanAcc * 100)}% avg` : "—"}
          </span>
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-white/[0.04]">
          {genNames.length === 0 ? (
            <div className="pt-2 text-[9px] font-mono text-zinc-600">No generator data in this baseline.</div>
          ) : (
            genNames.map((g) => (
              <div key={g} className="pt-2">
                <div className="text-[8px] font-mono tracking-wider uppercase text-zinc-500 mb-1.5">
                  {g === "arithmetic_chain" ? "Arithmetic Chain" : "Tower of Hanoi"}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[9px] font-mono">
                    <thead>
                      <tr className="text-zinc-600">
                        <th className="text-left pr-3 py-0.5">Cx</th>
                        <th className="text-right px-2 py-0.5">Acc</th>
                        <th className="text-right px-2 py-0.5">Tokens</th>
                        <th className="text-right px-2 py-0.5">H</th>
                        <th className="text-right px-2 py-0.5">2^H</th>
                        <th className="text-right px-2 py-0.5">Eff</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(generators[g] ?? []).map((lv) => {
                        const ms = Object.values(lv.models)[0];
                        if (!ms) return null;
                        return (
                          <tr key={lv.complexity} className="border-t border-white/[0.04]">
                            <td className="text-left pr-3 py-0.5 text-zinc-400">{lv.complexity}</td>
                            <td className="text-right px-2 py-0.5" style={{ color: ACC_COLOR(ms.accuracy) }}>
                              {ms.accuracy != null ? `${Math.round(ms.accuracy * 100)}%` : "—"}
                            </td>
                            <td className="text-right px-2 py-0.5 text-zinc-400">{ms.mean_tokens != null ? Math.round(ms.mean_tokens) : "—"}</td>
                            <td className="text-right px-2 py-0.5 text-zinc-400">{ms.mean_entropy != null ? ms.mean_entropy.toFixed(3) : "—"}</td>
                            <td className="text-right px-2 py-0.5 text-zinc-400">{ms.mean_branching != null ? ms.mean_branching.toFixed(2) : "—"}</td>
                            <td className="text-right px-2 py-0.5 text-zinc-400">{ms.efficiency_ratio != null ? `${ms.efficiency_ratio.toFixed(1)}×` : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
          {summary?.narrative && (
            <div className="text-[9px] font-mono text-zinc-500 whitespace-pre-wrap leading-relaxed border-t border-white/[0.04] pt-2">
              {summary.narrative.split("\n\n").map((para, i) => (
                <p key={i} className="mb-1.5">{para}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProbeHistoryPanel() {
  const [records, setRecords] = useState<ProbeBaseline[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<ProbeBaseline[]>("/api/probes/history?limit=200");
      setRecords(data ?? []);
    } catch {
      setError("Could not load probe history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => (cancelled ? undefined : load()))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [load, refresh]);

  const filtered = records.filter((r) => filter === "all" || r.type === filter);
  const reasoningCount = records.filter((r) => r.type === "reasoning").length;
  const complexityCount = records.filter((r) => r.type === "complexity").length;

  const filters: Filter[] = ["all", "reasoning", "complexity"];

  return (
    <div className="glass-panel p-5 space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[11px] font-semibold tracking-[0.28em] uppercase text-teal-mystic/60">
          Probe Baseline History
        </div>
        <button
          onClick={() => setRefresh((n) => n + 1)}
          className="ml-auto p-1.5 rounded border border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:text-zinc-200 hover:border-white/[0.15] transition-colors"
          aria-label="Refresh probe history"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <p className="text-[10px] text-zinc-500 font-mono leading-relaxed">
        Longitudinal probe baselines accumulated by the weekly cadence (Mon 03:00, seed 42).
        Reasoning battery = GSM-Symbolic fragility (base/symbolic/noop); complexity battery =
        Illusion-of-Thinking efficiency vs optimal.
      </p>

      {/* Type filter */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1.5">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded border transition-all ${
                filter === f
                  ? "bg-teal-mystic/15 text-teal-mystic border-teal-mystic/30"
                  : "bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:text-zinc-300 hover:border-white/[0.12]"
              }`}
            >
              {f === "all" ? `All (${records.length})` : f === "reasoning" ? `Reasoning (${reasoningCount})` : `Complexity (${complexityCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="text-[10px] text-zinc-600 font-mono">Loading probe history…</div>
      ) : error ? (
        <div className="text-[10px] text-red-400 font-mono">{error}</div>
      ) : records.length === 0 ? (
        <div className="text-[10px] text-zinc-600 font-mono leading-relaxed">
          No probe baselines yet. The weekly timer ({`mythic-probe-baseline.timer`}) runs the reasoning +
          complexity batteries at Mon 03:00 and appends here. First record appears after the next run —
          or trigger one now via{" "}
          <span className="text-zinc-400">tools/run_probe_baseline.py</span>.
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-[10px] text-zinc-600 font-mono">No {filter} baselines recorded yet.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) =>
            r.type === "reasoning" ? (
              <ReasoningRecord key={r.run_id} record={r} />
            ) : (
              <ComplexityRecord key={r.run_id} record={r} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
