"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import ResearchPopover from "./ResearchPopover";
import { apiGet, apiPost } from "@/lib/api";
import { pollUntil, type PollHandle } from "@/lib/usePoll";
import type { TraceSummary } from "@/types/trace";

const GENERATORS = [
  { id: "arithmetic_chain", label: "Arithmetic Chain", desc: "Sequential +/- operations, 2–10 ops" },
  { id: "tower_of_hanoi", label: "Tower of Hanoi", desc: "Minimum moves = 2^N − 1, 2–8 discs" },
];

interface ModelOption { name: string; provider: "local" | "worker"; }

interface ComplexityCell {
  cell_id: string; model: string; provider: string;
  generator: string; complexity: number; instance: number;
  prompt: string; expected: number | null;
  response: string; parsed: number | null;
  correct: boolean | null; status: string; error: string | null;
  entropy_mean: number | null; entropy_p95: number | null;
  median_branching: number | null; tokens: number | null;
  optimal_tokens: number | null;
}

interface ProbeRun {
  run_id: string; status: string; seed: number;
  total: number; completed: number; failed: number;
  cells: ComplexityCell[];
}

interface ComplexityLevel {
  complexity: number; optimal_tokens: number;
  models: Record<string, {
    n: number; accuracy: number | null;
    mean_tokens: number | null; mean_entropy: number | null;
    mean_branching: number | null; efficiency_ratio: number | null;
  }>;
}

interface Summary {
  run_id: string; status: string;
  generators: Record<string, ComplexityLevel[]>;
  narrative?: string;
}

const ACC_COLOR = (acc: number | null | undefined) => {
  if (acc == null) return "var(--color-zinc-600)";
  if (acc >= 0.8) return "#34d399";  // emerald-400
  if (acc >= 0.5) return "#fbbf24";  // amber-400
  return "#f87171";  // red-400
};

const MODEL_COLORS = ["#2dd4bf", "#a78bfa", "#fb923c", "#60a5fa", "#f472b6", "#facc15"];

function LineChart({
  data,
  generators,
  yLabel,
  optimalLine,
  yDomain,
  formatY,
}: {
  data: Record<string, Array<{ x: number; y: Record<string, number | null> }>>;
  generators: string[];
  yLabel: string;
  optimalLine?: Record<string, number[]>;
  yDomain?: [number, number];
  formatY?: (v: number) => string;
}) {
  const W = 560, H = 180, PAD = { top: 20, right: 20, bottom: 28, left: 50 };
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;

  // Collect all x values, sort
  const allX = Array.from(new Set(generators.flatMap(g => (data[g] ?? []).map(d => d.x)))).sort((a, b) => a - b);
  if (allX.length === 0) return <div className="text-[10px] text-zinc-600 font-mono">No data yet</div>;

  // Collect all model names across generators
  const allModels = Array.from(new Set(generators.flatMap(g =>
    (data[g] ?? []).flatMap(d => Object.keys(d.y))
  )));

  // Y domain
  let minY = Infinity, maxY = -Infinity;
  for (const g of generators) {
    for (const d of (data[g] ?? [])) {
      for (const v of Object.values(d.y)) {
        if (v != null) { minY = Math.min(minY, v); maxY = Math.max(maxY, v); }
      }
    }
  }
  if (optimalLine) {
    for (const vals of Object.values(optimalLine)) {
      for (const v of vals) { maxY = Math.max(maxY, v); }
    }
  }
  if (!isFinite(minY)) { minY = 0; maxY = 1; }
  const yLo = yDomain?.[0] ?? Math.max(0, minY - (maxY - minY) * 0.1);
  const yHi = yDomain?.[1] ?? (maxY + (maxY - minY) * 0.1 || 1);

  const sx = (x: number) => {
    const idx = allX.indexOf(x);
    return PAD.left + (allX.length === 1 ? iw / 2 : (idx / (allX.length - 1)) * iw);
  };
  const sy = (v: number) => PAD.top + ih - ((v - yLo) / (yHi - yLo)) * ih;

  const fmt = formatY ?? ((v: number) => v.toFixed(1));

  // Group x values by generator for offset
  const genOffsets: Record<string, number> = {};
  const nGens = generators.length;
  generators.forEach((g, i) => { genOffsets[g] = (i - (nGens - 1) / 2) * 6; });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 180 }}>
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(frac => {
        const v = yLo + frac * (yHi - yLo);
        const y = sy(v);
        return <line key={frac} x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="rgba(255,255,255,0.05)" />;
      })}

      {/* Y axis labels */}
      {[0, 0.25, 0.5, 0.75, 1].map(frac => {
        const v = yLo + frac * (yHi - yLo);
        return <text key={frac} x={PAD.left - 6} y={sy(v) + 3} textAnchor="end" fontSize={8} fill="rgba(255,255,255,0.35)" fontFamily="monospace">{fmt(v)}</text>;
      })}

      {/* Optimal line */}
      {optimalLine && generators.map(g => {
        const vals = optimalLine[g];
        if (!vals) return null;
        const pts = allX.map((x, i) => `${sx(x) + genOffsets[g]},${sy(vals[i] ?? 0)}`).join(" ");
        return <polyline key={`opt-${g}`} points={pts} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="4 3" />;
      })}

      {/* Lines per model per generator */}
      {generators.map((g, gi) => {
        const series = data[g] ?? [];
        return allModels.map((model, mi) => {
          const pts = series
            .filter(d => d.y[model] != null)
            .map(d => `${sx(d.x) + genOffsets[g]},${sy(d.y[model]!)}`);
          if (pts.length < 2) return null;
          return (
            <polyline
              key={`${g}-${model}`}
              points={pts.join(" ")}
              fill="none"
              stroke={MODEL_COLORS[mi % MODEL_COLORS.length]}
              strokeWidth={1.5}
              opacity={gi === 0 ? 1 : 0.55}
              strokeDasharray={gi === 1 ? "5 3" : undefined}
            />
          );
        });
      })}

      {/* Dots */}
      {generators.map((g, gi) => {
        const series = data[g] ?? [];
        return series.flatMap((d, di) =>
          allModels.map((model, mi) => {
            const v = d.y[model];
            if (v == null) return null;
            return (
              <circle
                key={`${g}-${model}-${di}`}
                cx={sx(d.x) + genOffsets[g]}
                cy={sy(v)}
                r={2.5}
                fill={MODEL_COLORS[mi % MODEL_COLORS.length]}
                opacity={gi === 0 ? 0.9 : 0.5}
              />
            );
          })
        );
      })}

      {/* X axis labels */}
      {allX.map(x => (
        <text key={x} x={sx(x)} y={H - 4} textAnchor="middle" fontSize={8} fill="rgba(255,255,255,0.35)" fontFamily="monospace">{x}</text>
      ))}

      {/* Y label */}
      <text x={10} y={H / 2} textAnchor="middle" fontSize={8} fill="rgba(255,255,255,0.3)" fontFamily="monospace" transform={`rotate(-90, 10, ${H / 2})`}>{yLabel}</text>
    </svg>
  );
}

export default function ComplexityLadderPanel() {
  const [allModels, setAllModels] = useState<ModelOption[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [selectedGens, setSelectedGens] = useState<Set<string>>(new Set(GENERATORS.map(g => g.id)));
  const [loadingModels, setLoadingModels] = useState(true);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<ProbeRun | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pollRef = useRef<PollHandle<ProbeRun> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingModels(true);
      const [traces, localModels, netData] = await Promise.all([
        apiGet<TraceSummary[]>("/api/traces?limit=200").catch(() => []),
        apiGet<{ models?: string[] }>("/api/models").catch(() => ({ models: [] })),
        apiGet<{ sources: { models: string[] }[] }>("/api/models/network").catch(() => ({ sources: [] })),
      ]);
      const localSet = new Set(localModels.models ?? []);
      const workerSet = new Set<string>();
      const workerBaseNames = new Set<string>();
      const workerFamilies = new Set<string>();
      for (const src of netData.sources ?? []) {
        for (const m of src.models ?? []) {
          workerSet.add(m);
          const base = m.includes("/") ? m.split("/").pop()! : m;
          workerBaseNames.add(base);
          const family = base.split(":")[0];
          if (family) workerFamilies.add(family);
        }
      }
      const detectProvider = (name: string): "local" | "worker" => {
        if (localSet.has(name)) return "local";
        if (workerSet.has(name)) return "worker";
        const base = name.includes("/") ? name.split("/").pop()! : name;
        if (workerBaseNames.has(base)) return "worker";
        const family = base.split(":")[0];
        if (family && workerFamilies.has(family)) return "worker";
        return "local";
      };
      const seen = new Set<string>();
      const models: ModelOption[] = [];
      for (const t of traces) {
        const name = t.model_used;
        if (!name) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        models.push({ name, provider: detectProvider(name) });
      }
      models.sort((a, b) => a.name.localeCompare(b.name));
      if (!cancelled) {
        setAllModels(models);
        setLoadingModels(false);
        if (models.length > 0) setSelectedModels(new Set([models[0].name]));
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return () => { pollRef.current?.stop(); };
  }, []);

  const toggleModel = (name: string) => {
    setSelectedModels(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  };
  const toggleGen = (id: string) => {
    setSelectedGens(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const pollRun = (runId: string) => {
    pollRef.current?.stop();
    const handle = pollUntil<ProbeRun>(
      () => apiGet<ProbeRun>(`/api/probe/complexity/${runId}`),
      (data) => data.status === "done",
      {
        intervalMs: 2000,
        onTick: (data) => {
          setRun(data);
          if (data.status === "done") {
            apiGet<Summary>(`/api/probe/complexity/${runId}/summary`)
              .then(setSummary)
              .catch(() => {});
            setRunning(false);
          }
        },
      },
    );
    pollRef.current = handle;
    handle.promise.catch(() => {
      setRunning(false);
    });
  };

  const handleRun = async () => {
    const models = allModels.filter(m => selectedModels.has(m.name)).map(m => ({ provider: m.provider, model: m.name }));
    if (models.length === 0 || selectedGens.size === 0) return;
    setRunning(true);
    setSummary(null);
    setRun(null);
    try {
      const { run_id } = await apiPost<{ run_id: string }>("/api/probe/complexity", {
        models,
        generators: [...selectedGens],
      });
      pollRun(run_id);
    } catch {
      setRunning(false);
    }
  };

  const toggleCell = (id: string) => {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  // Build chart data from summary
  const chartData: Record<string, Array<{ x: number; y: Record<string, number | null> }>> = {};
  const optimalData: Record<string, number[]> = {};
  const activeGens = [...selectedGens];
  for (const g of activeGens) {
    const levels = summary?.generators?.[g] ?? [];
    chartData[g] = levels.map(lv => ({
      x: lv.complexity,
      y: Object.fromEntries(Object.entries(lv.models).map(([m, md]) => [m, md.accuracy])),
    }));
    optimalData[g] = levels.map(lv => lv.optimal_tokens);
  }

  // Tokens chart data
  const tokensData: Record<string, Array<{ x: number; y: Record<string, number | null> }>> = {};
  const optimalTokensData: Record<string, number[]> = {};
  for (const g of activeGens) {
    const levels = summary?.generators?.[g] ?? [];
    tokensData[g] = levels.map(lv => ({
      x: lv.complexity,
      y: Object.fromEntries(Object.entries(lv.models).map(([m, md]) => [m, md.mean_tokens])),
    }));
    optimalTokensData[g] = levels.map(lv => lv.optimal_tokens);
  }

  // Entropy chart data
  const entropyData: Record<string, Array<{ x: number; y: Record<string, number | null> }>> = {};
  for (const g of activeGens) {
    const levels = summary?.generators?.[g] ?? [];
    entropyData[g] = levels.map(lv => ({
      x: lv.complexity,
      y: Object.fromEntries(Object.entries(lv.models).map(([m, md]) => [m, md.mean_entropy])),
    }));
  }

  // All model names across summary
  const allSummaryModels = Array.from(new Set(
    Object.values(summary?.generators ?? {}).flatMap(levels =>
      levels.flatMap(lv => Object.keys(lv.models))
    )
  ));

  const pending = run ? run.total - run.completed - run.failed : 0;

  return (
    <div className="glass-panel p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="text-[11px] font-semibold tracking-[0.28em] uppercase text-teal-mystic/60">
          Complexity Ladder Probe
        </div>
        <ResearchPopover refKey="reasoning-fragility" />
      </div>

      <p className="text-[10px] text-zinc-500 font-mono leading-relaxed">
        Illusion of Thinking method (Shojaee et al., arXiv:2506.06941): measure{" "}
        <span className="text-zinc-300">accuracy</span>,{" "}
        <span className="text-zinc-300">thinking tokens</span>, and{" "}
        <span className="text-zinc-300">token entropy</span> as complexity scales.
        The paper predicts reasoning effort rises, peaks, then collapses near the failure point.
      </p>

      {/* Model selection */}
      <div className="space-y-1.5">
        <span className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">Models under test</span>
        {loadingModels ? (
          <div className="text-[10px] text-zinc-600 font-mono">Loading available models…</div>
        ) : allModels.length === 0 ? (
          <div className="text-[10px] text-zinc-600 font-mono">No models found in trace history</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {allModels.map(m => {
              const active = selectedModels.has(m.name);
              return (
                <button
                  key={m.name}
                  onClick={() => toggleModel(m.name)}
                  className={`text-[10px] font-mono px-2 py-1 rounded border transition-all flex items-center gap-1.5 ${
                    active
                      ? "bg-teal-mystic/15 text-teal-mystic border-teal-mystic/30"
                      : "bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:text-zinc-300 hover:border-white/[0.12]"
                  }`}
                >
                  {m.name}
                  <span className={`text-[7px] uppercase tracking-wider px-1 rounded ${
                    m.provider === "worker" ? "bg-amber/10 text-amber/60" : "bg-teal-mystic/10 text-teal-mystic/50"
                  }`}>
                    {m.provider}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Generator selection */}
      <div className="space-y-1.5">
        <span className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">Generators</span>
        <div className="flex flex-wrap gap-1.5">
          {GENERATORS.map(g => {
            const active = selectedGens.has(g.id);
            return (
              <button
                key={g.id}
                onClick={() => toggleGen(g.id)}
                className={`text-[10px] font-mono px-2 py-1 rounded border transition-all text-left ${
                  active
                    ? "bg-violet/10 text-violet-300 border-violet-400/30"
                    : "bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:text-zinc-300 hover:border-white/[0.12]"
                }`}
              >
                <div>{g.label}</div>
                <div className="text-[8px] text-zinc-600 mt-0.5">{g.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <button
        onClick={handleRun}
        disabled={running || selectedModels.size === 0 || selectedGens.size === 0}
        className="w-full px-4 py-2.5 rounded-lg text-[11px] font-semibold tracking-wider uppercase
          bg-teal-mystic/10 text-teal-mystic border border-teal-mystic/20
          hover:bg-teal-mystic/20 transition-colors
          disabled:opacity-30 disabled:cursor-not-allowed
          flex items-center justify-center gap-2"
      >
        {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
        {running ? `Running… ${run?.completed ?? 0}/${run?.total ?? 0} cells` : "Run Complexity Probe"}
      </button>

      {/* Charts */}
      {summary && (
        <div className="space-y-4">
          {/* Model legend */}
          {allSummaryModels.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {allSummaryModels.map((m, i) => (
                <div key={m} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: MODEL_COLORS[i % MODEL_COLORS.length] }} />
                  <span className="text-[9px] font-mono text-zinc-400">{m}</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <div className="w-4 border-t border-dashed border-white/20" />
                <span className="text-[9px] font-mono text-zinc-500">optimal</span>
              </div>
            </div>
          )}

          {/* Accuracy curve */}
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 space-y-1">
            <div className="text-[9px] font-mono tracking-wider text-zinc-500 uppercase">Accuracy vs Complexity</div>
            <LineChart data={chartData} generators={activeGens} yLabel="accuracy" yDomain={[0, 1.05]} formatY={v => `${Math.round(v * 100)}%`} />
          </div>

          {/* Effort (tokens) curve */}
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 space-y-1">
            <div className="text-[9px] font-mono tracking-wider text-zinc-500 uppercase">Thinking Tokens vs Complexity</div>
            <LineChart data={tokensData} generators={activeGens} yLabel="tokens" optimalLine={optimalTokensData} formatY={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`} />
          </div>

          {/* Entropy progression */}
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 space-y-1">
            <div className="text-[9px] font-mono tracking-wider text-zinc-500 uppercase">Token Entropy vs Complexity</div>
            <LineChart data={entropyData} generators={activeGens} yLabel="entropy" formatY={v => v.toFixed(3)} />
          </div>

          {/* Per-model summary cards */}
          {allSummaryModels.map(model => (
            <div key={model} className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3 space-y-2">
              <div className="text-[10px] font-mono text-zinc-300">{model}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-[9px] font-mono">
                  <thead>
                    <tr className="text-zinc-600">
                      <th className="text-left pr-3 py-1">Gen</th>
                      <th className="text-right px-2 py-1">Cx</th>
                      <th className="text-right px-2 py-1">Acc</th>
                      <th className="text-right px-2 py-1">Tokens</th>
                      <th className="text-right px-2 py-1">Entropy</th>
                      <th className="text-right px-2 py-1">2^H</th>
                      <th className="text-right px-2 py-1">Eff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeGens.map(g => {
                      const levels = summary.generators?.[g] ?? [];
                      return levels.map(lv => {
                        const md = lv.models[model];
                        if (!md) return null;
                        return (
                          <tr key={`${g}-${lv.complexity}`} className="border-t border-white/[0.04]">
                            <td className="text-left pr-3 py-1 text-zinc-500">{g === "arithmetic_chain" ? "Arith" : "Hanoi"}</td>
                            <td className="text-right px-2 py-1 text-zinc-400">{lv.complexity}</td>
                            <td className="text-right px-2 py-1" style={{ color: ACC_COLOR(md.accuracy) }}>
                              {md.accuracy != null ? `${Math.round(md.accuracy * 100)}%` : "—"}
                            </td>
                            <td className="text-right px-2 py-1 text-zinc-400">{md.mean_tokens != null ? Math.round(md.mean_tokens) : "—"}</td>
                            <td className="text-right px-2 py-1 text-zinc-400">{md.mean_entropy != null ? md.mean_entropy.toFixed(3) : "—"}</td>
                            <td className="text-right px-2 py-1 text-zinc-400">{md.mean_branching != null ? md.mean_branching.toFixed(2) : "—"}</td>
                            <td className="text-right px-2 py-1 text-zinc-400">{md.efficiency_ratio != null ? `${md.efficiency_ratio.toFixed(2)}×` : "—"}</td>
                          </tr>
                        );
                      });
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* Narrative */}
          {summary.narrative && (
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3">
              <div className="text-[9px] font-mono tracking-wider text-zinc-500 uppercase mb-2">Interpretation</div>
              <div className="text-[10px] text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed">
                {summary.narrative.split("\n\n").map((para, i) => {
                  if (para.startsWith("**")) {
                    const parts = para.split("**").map((p, j) =>
                      j % 2 === 1 ? <strong key={j} className="text-zinc-300">{p}</strong> : <span key={j}>{p}</span>
                    );
                    return <p key={i} className="mb-2">{parts}</p>;
                  }
                  return <p key={i} className="mb-2">{para}</p>;
                })}
              </div>
            </div>
          )}

          {/* Expandable cell detail */}
          {run && run.cells.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">Cell detail ({run.cells.length})</span>
              {run.cells.slice(0, 50).map(c => {
                const isOpen = expanded.has(c.cell_id);
                return (
                  <div key={c.cell_id} className="bg-white/[0.02] border border-white/[0.06] rounded-lg">
                    <button
                      onClick={() => toggleCell(c.cell_id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[10px] font-mono hover:bg-white/[0.03] transition-colors"
                    >
                      {isOpen ? <ChevronDown size={10} className="text-zinc-600 shrink-0" /> : <ChevronRight size={10} className="text-zinc-600 shrink-0" />}
                      <span className="text-zinc-500 shrink-0">{c.generator === "arithmetic_chain" ? "Arith" : "Hanoi"} cx={c.complexity}</span>
                      <span className="text-zinc-600 shrink-0">inst={c.instance}</span>
                      <span className="text-zinc-400 truncate">{c.model}</span>
                      <span className="ml-auto shrink-0" style={{ color: c.correct ? "#34d399" : c.correct === false ? "#f87171" : "rgba(255,255,255,0.2)" }}>
                        {c.correct != null ? (c.correct ? "correct" : `wrong (${c.parsed ?? "?"} ≠ ${c.expected ?? "?"})`) : c.status}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 space-y-2 text-[9px] font-mono border-t border-white/[0.04]">
                        <div className="pt-2 space-y-1">
                          <div className="text-zinc-500">Prompt: <span className="text-zinc-400">{c.prompt}</span></div>
                          <div className="text-zinc-500">Expected: <span className="text-zinc-300">{c.expected}</span></div>
                          <div className="text-zinc-500">Parsed: <span className="text-zinc-300">{c.parsed ?? "—"}</span></div>
                          {c.entropy_mean != null && <div className="text-zinc-500">Entropy: <span className="text-zinc-400">{c.entropy_mean.toFixed(4)} (p95: {c.entropy_p95?.toFixed(4) ?? "—"}, 2^H: {c.median_branching?.toFixed(4) ?? "—"})</span></div>}
                          {c.tokens != null && <div className="text-zinc-500">Tokens: <span className="text-zinc-400">{c.tokens} (optimal ≈ {c.optimal_tokens})</span></div>}
                          <div className="text-zinc-500">Response: <span className="text-zinc-400 whitespace-pre-wrap">{c.response}</span></div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
