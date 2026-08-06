"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import ResearchPopover from "./ResearchPopover";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

const TEMPLATES = [
  { id: "clips", title: "Half-as-many second month" },
  { id: "fruit", title: "Total fruit count" },
  { id: "train", title: "Constant-speed distance" },
  { id: "pencils", title: "Per-student pencils" },
  { id: "baker", title: "Loaves sold twice-over" },
];

interface ModelOption {
  name: string;
  provider: "local" | "worker";
}

interface ProbeCell {
  cell_id: string;
  model: string;
  provider: string;
  template_id: string;
  title: string;
  variant: "base" | "symbolic" | "noop";
  prompt: string;
  expected: number | null;
  response: string;
  parsed: number | null;
  correct: boolean | null;
  status: string;
  error: string | null;
  entropy_mean: number | null;
  entropy_p95: number | null;
  median_branching: number | null;
  ddc_margin: number | null;
  tokens: number | null;
}

interface ProbeRun {
  run_id: string;
  status: string;
  seed: number;
  total: number;
  completed: number;
  failed: number;
  cells: ProbeCell[];
}

interface VariantStat {
  n: number;
  accuracy: number | null;
  entropy_mean: number | null;
  median_branching: number | null;
  ddc_margin: number | null;
}

interface ProbeSummary {
  run_id: string;
  status: string;
  rows: Array<{
    model: string;
    base?: VariantStat;
    symbolic?: VariantStat;
    noop?: VariantStat;
    drop_symbolic?: number;
    drop_noop?: number;
  }>;
}

const ACC_COLOR = (acc: number | null | undefined) => {
  if (acc == null) return "text-zinc-600";
  if (acc >= 0.8) return "text-emerald-400";
  if (acc >= 0.5) return "text-amber-400";
  return "text-red-400";
};

export default function ReasoningProbePanel() {
  const [allModels, setAllModels] = useState<ModelOption[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set(TEMPLATES.map((t) => t.id)));
  const [loadingModels, setLoadingModels] = useState(true);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<ProbeRun | null>(null);
  const [summary, setSummary] = useState<ProbeSummary | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingModels(true);
      const [traceRes, localRes, netRes] = await Promise.all([
        fetch(`${API_BASE}/api/traces?limit=200`),
        fetch(`${API_BASE}/api/models`),
        fetch(`${API_BASE}/api/models/network`),
      ]);
      const traces: any[] = traceRes.ok ? await traceRes.json() : [];
      const localModels: string[] = localRes.ok ? (await localRes.json()).models ?? [] : [];
      const netData: { sources: any[] } = netRes.ok ? await netRes.json() : { sources: [] };
      const localSet = new Set(localModels);
      const workerSet = new Set<string>();
      for (const src of netData.sources ?? []) for (const m of src.models ?? []) workerSet.add(m);
      const seen = new Set<string>();
      const models: ModelOption[] = [];
      for (const t of traces) {
        const name: string = t.model_used;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        models.push({ name, provider: localSet.has(name) ? "local" : workerSet.has(name) ? "worker" : "local" });
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
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const toggleModel = (name: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleTemplate = (id: string) => {
    setSelectedTemplates((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pollRun = async (runId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/probe/reasoning/${runId}`);
        if (!res.ok) throw new Error("status fetch failed");
        const data: ProbeRun = await res.json();
        setRun(data);
        if (data.status === "done") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          const sumRes = await fetch(`${API_BASE}/api/probe/reasoning/${runId}/summary`);
          if (sumRes.ok) setSummary(await sumRes.json());
          setRunning(false);
        }
      } catch {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setRunning(false);
      }
    }, 2000);
  };

  const handleRun = async () => {
    const models = allModels.filter((m) => selectedModels.has(m.name)).map((m) => ({ provider: m.provider, model: m.name }));
    if (models.length === 0 || selectedTemplates.size === 0) return;
    setRunning(true);
    setSummary(null);
    setRun(null);
    try {
      const res = await fetch(`${API_BASE}/api/probe/reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models, template_ids: [...selectedTemplates] }),
      });
      if (!res.ok) throw new Error("run start failed");
      const { run_id } = await res.json();
      pollRun(run_id);
    } catch {
      setRunning(false);
    }
  };

  const toggleCell = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pending = run ? run.total - run.completed - run.failed : 0;

  return (
    <div className="glass-panel p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="text-[11px] font-semibold tracking-[0.28em] uppercase text-teal-mystic/60">
          Reasoning Fragility Probe
        </div>
        <ResearchPopover refKey="reasoning-fragility" />
      </div>

      <p className="text-[10px] text-zinc-500 font-mono leading-relaxed">
        GSM-Symbolic method (arXiv:2410.05229): each word problem runs in{" "}
        <span className="text-zinc-300">base</span>,{" "}
        <span className="text-zinc-300">symbolic</span> (re-rolled names + numbers, answer recomputed), and{" "}
        <span className="text-zinc-300">noop</span> (base + irrelevant distractor premise). The accuracy drop is the
        fragility signature; entropy / 2^H / DDC margin tell the mechanism.
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
            {allModels.map((m) => {
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

      {/* Template selection */}
      <div className="space-y-1.5">
        <span className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">Problem templates</span>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATES.map((t) => {
            const active = selectedTemplates.has(t.id);
            return (
              <button
                key={t.id}
                onClick={() => toggleTemplate(t.id)}
                className={`text-[10px] font-mono px-2 py-1 rounded border transition-all ${
                  active
                    ? "bg-violet/10 text-violet-300 border-violet-400/30"
                    : "bg-white/[0.03] text-zinc-500 border-white/[0.06] hover:text-zinc-300 hover:border-white/[0.12]"
                }`}
              >
                {t.title}
              </button>
            );
          })}
        </div>
      </div>

      <button
        onClick={handleRun}
        disabled={running || selectedModels.size === 0 || selectedTemplates.size === 0}
        className="w-full px-4 py-2.5 rounded-lg text-[11px] font-semibold tracking-wider uppercase
          bg-teal-mystic/10 text-teal-mystic border border-teal-mystic/20
          hover:bg-teal-mystic/20 transition-colors
          disabled:opacity-30 disabled:cursor-not-allowed
          flex items-center justify-center gap-2"
      >
        {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
        {running ? `Running… ${run?.completed ?? 0}/${run?.total ?? 0} cells` : "Run Probe"}
      </button>

      {/* Summary table */}
      {summary && summary.rows.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-zinc-400">Fragility signature</span>
            <span className="text-[9px] font-mono text-zinc-600">seed {run?.seed} · {summary.rows[0]?.base?.n ?? 0} problems per cell</span>
          </div>
          <div className="space-y-2">
            {summary.rows.map((row) => {
              const baseAcc = row.base?.accuracy;
              const hasDrop = baseAcc != null && ((row.drop_symbolic ?? 0) > 0 || (row.drop_noop ?? 0) > 0);
              return (
                <div key={row.model} className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-zinc-300">{row.model}</span>
                    {hasDrop && (
                      <span className="text-[9px] font-mono text-amber-400/80">
                        fragile: −{Math.round((row.drop_symbolic ?? 0) * 100)}% symbolic, −{Math.round((row.drop_noop ?? 0) * 100)}% noop
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["base", "symbolic", "noop"] as const).map((v) => {
                      const s = row[v];
                      if (!s) return null;
                      const acc = s.accuracy;
                      return (
                        <div key={v} className={`rounded-md border p-2 space-y-0.5 ${
                          v === "base" ? "border-teal-mystic/20 bg-teal-mystic/[0.04]" : "border-white/[0.06] bg-white/[0.02]"
                        }`}>
                          <div className="text-[8px] font-mono uppercase tracking-wider text-zinc-600">{v}</div>
                          <div className={`text-[14px] font-mono ${ACC_COLOR(acc)}`}>
                            {acc == null ? "—" : `${(acc * 100).toFixed(0)}%`}
                            <span className="text-[8px] text-zinc-600"> /{s.n}</span>
                          </div>
                          <div className="text-[8px] font-mono text-zinc-600 space-x-1">
                            {s.entropy_mean != null && <span>H {s.entropy_mean.toFixed(3)}</span>}
                            {s.median_branching != null && <span className="text-teal-400/60">2^H {s.median_branching.toFixed(2)}</span>}
                          </div>
                          {s.ddc_margin != null && (
                            <div className="text-[8px] font-mono text-zinc-600">margin {s.ddc_margin.toFixed(3)}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Cell detail */}
          {run && (
            <div className="space-y-1">
              <span className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">Cell detail</span>
              {run.cells.map((cell) => {
                const open = expanded.has(cell.cell_id);
                return (
                  <div key={cell.cell_id} className="border border-white/[0.05] rounded-md">
                    <button
                      onClick={() => toggleCell(cell.cell_id)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
                    >
                      {open ? <ChevronDown size={11} className="text-zinc-600 shrink-0" /> : <ChevronRight size={11} className="text-zinc-600 shrink-0" />}
                      <span className={`text-[10px] font-mono ${cell.correct === null ? "text-zinc-600" : cell.correct ? "text-emerald-400" : "text-red-400"}`}>
                        {cell.correct === null ? (cell.status === "error" ? "ERR" : "…") : cell.correct ? "✓" : "✗"}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400">{cell.title}</span>
                      <span className="text-[9px] font-mono text-zinc-600">{cell.variant}</span>
                      <span className="ml-auto text-[9px] font-mono text-zinc-600">
                        {cell.expected != null && <>expected {cell.expected}</>}
                        {cell.parsed != null && <span className="text-zinc-400"> · got {cell.parsed}</span>}
                      </span>
                    </button>
                    {open && (
                      <div className="px-3 pb-2 space-y-1.5">
                        <div className="text-[9px] font-mono text-zinc-500 leading-relaxed">{cell.prompt}</div>
                        <div className="text-[9px] font-mono text-zinc-400 leading-relaxed">{cell.response || cell.error}</div>
                        {cell.entropy_mean != null && (
                          <div className="text-[8px] font-mono text-zinc-600">
                            H {cell.entropy_mean.toFixed(4)} · p95 {cell.entropy_p95?.toFixed(4)} · 2^H med {cell.median_branching?.toFixed(3)} · margin {cell.ddc_margin?.toFixed(4)} · {cell.tokens ?? "—"} tokens
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {run && run.status === "running" && pending > 0 && (
        <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500">
          <Loader2 size={11} className="animate-spin" />
          {run.completed}/{run.total} cells done · {pending} queued · {run.failed} failed
        </div>
      )}
    </div>
  );
}
