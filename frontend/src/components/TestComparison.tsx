"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Download } from "lucide-react";
import type { Probe } from "@/types/trace";
import { useToast } from "@/lib/ToastContext";
import { apiGet, apiPost } from "@/lib/api";
import { pollUntil, type PollHandle } from "@/lib/usePoll";

interface ModelOption {
  name: string;
  provider: "local" | "worker";
}

interface ClassifyCellResult {
  trace_id: string;
  model: string;
  provider: string;
  probe_idx: number;
  value: string;
  confidence: number | null;
  error: string | null;
}

interface ClassifyTaskStatus {
  task_id: string;
  total_cells: number;
  completed_cells: number;
  status: string;
  warmup_status: string | null;
  results: ClassifyCellResult[];
}

interface Props {
  probes: Probe[];
  models: ModelOption[];
}

export default function TestComparison({ probes, models }: Props) {
  const { addToast } = useToast();
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [results, setResults] = useState<ClassifyCellResult[]>([]);
  const [totalCells, setTotalCells] = useState(0);
  const [completedCells, setCompletedCells] = useState(0);
  const [warmupStatus, setWarmupStatus] = useState<string | null>(null);
  const [activeProbeIdx, setActiveProbeIdx] = useState(0);
  const [wasCancelled, setWasCancelled] = useState(false);
  const pollRef = useRef<PollHandle<ClassifyTaskStatus> | null>(null);

  // Start classify task when probes+models change
  useEffect(() => {
    if (probes.length === 0 || models.length === 0) return;
    let cancelled = false;
    setStatus("running");
    setResults([]);
    setWarmupStatus(null);
    setActiveProbeIdx(0);
    setWasCancelled(false);

    apiPost<{ task_id: string; total_cells: number }>("/api/tests/classify", {
      probes: probes.map((p) => ({ action: p.action, attribute: p.attribute, artefact: p.artefact })),
      models: models.map((m) => ({ model: m.name, provider: m.provider })),
      max_traces: 50,
    })
      .then((data) => {
        if (!cancelled) {
          setTaskId(data.task_id);
          setTotalCells(data.total_cells);
        }
      })
      .catch((e) => {
        if (!cancelled) { setStatus("error"); addToast(String(e), "error", 3000); }
      });

    return () => { cancelled = true; };
  }, [probes, models]);

  // Poll for results every 2s
  useEffect(() => {
    if (!taskId) return;
    pollRef.current?.stop();
    const handle = pollUntil<ClassifyTaskStatus>(
      () => apiGet<ClassifyTaskStatus>(`/api/tests/classify/${taskId}`),
      (data) => data.status === "done" || data.status === "cancelled",
      {
        intervalMs: 2000,
        onTick: (data) => {
          setResults(data.results);
          setCompletedCells(data.completed_cells);
          if (data.warmup_status) setWarmupStatus(data.warmup_status);
        },
      },
    );
    pollRef.current = handle;
    handle.promise
      .then((data) => {
        if (data.status === "cancelled") setWasCancelled(true);
        setStatus("done");
        addToastRef.current("Classification complete", "success", 3000);
      })
      .catch((e) => {
        if (!(e instanceof DOMException)) setStatus("error");
      });
    return () => handle.stop();
  }, [taskId]);

  // Unique trace IDs and model names from results/props
  const modelNames = models.length > 0
    ? models.map((m) => m.name)
    : [...new Set(results.map((r) => r.model))];

  const traceIds = useMemo(() => [...new Set(results.map((r) => r.trace_id))], [results]);

  const probeLabels = useMemo(() => {
    return probes.map((p) => {
      const artefactLabel = p.artefact === "prompt" ? "Prompt" : "Output";
      const attrLabel: Record<string, string> = {
        ddc: "DDC", lcc: "LCC", intent: "Intent",
        synesth_input: "Synesthesia Input", synesth_output: "Synesthesia Output",
      };
      return `${attrLabel[p.attribute] || p.attribute} (${artefactLabel})`;
    });
  }, [probes]);

  // Generate a trace document
  const handleGenerateDoc = useCallback(async (traceId: string) => {
    try {
      const trace = await apiGet<any>(`/api/traces/${traceId}`);
      const doc = [
        `Trace: ${trace.id}`,
        `Model: ${trace.model_used || "unknown"}`,
        `Timestamp: ${trace.timestamp || ""}`,
        "",
        "── Prompt ──",
        trace.input || trace.prompt || "(empty)",
        "",
        "── Response ──",
        (trace.output || trace.response || "(empty)").replace(
          /\[(Response Generation|Intent Classification|Context Assembly)\]:\s*/g, ""
        ),
        "",
      ].join("\n");
      const blob = new Blob([doc], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trace-${traceId.slice(0, 8)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      addToastRef.current("Failed to fetch trace", "error", 3000);
    }
  }, []);

  // Determine if a row has disagreement for the active probe
  const disagreeRows = useMemo(() => {
    const set = new Set<string>();
    for (const tid of traceIds) {
      const values = results.filter(
        (r) => r.trace_id === tid && r.probe_idx === activeProbeIdx && !r.error
      ).map((r) => r.value);
      if (values.length >= 2 && new Set(values).size > 1) {
        set.add(tid);
      }
    }
    return set;
  }, [results, traceIds, activeProbeIdx]);

  // Pairwise agreement matrix across models
  const agreementMatrix = useMemo(() => {
    if (modelNames.length < 2) return null;
    const pairs: { m1: string; m2: string; match: number; total: number; pct: number }[] = [];
    for (let i = 0; i < modelNames.length; i++) {
      for (let j = i + 1; j < modelNames.length; j++) {
        let match = 0, total = 0;
        for (const tid of traceIds) {
          const a = results.find(
            (r) => r.trace_id === tid && r.model === modelNames[i] && r.probe_idx === activeProbeIdx && !r.error
          );
          const b = results.find(
            (r) => r.trace_id === tid && r.model === modelNames[j] && r.probe_idx === activeProbeIdx && !r.error
          );
          if (a && b) {
            total++;
            if (a.value === b.value) match++;
          }
        }
        pairs.push({
          m1: modelNames[i], m2: modelNames[j],
          match, total, pct: total > 0 ? Math.round((match / total) * 100) : 0,
        });
      }
    }
    return pairs;
  }, [results, traceIds, modelNames, activeProbeIdx]);

  // Per-model average agreement with all other models
  const modelAvgAgreement = useMemo(() => {
    if (!agreementMatrix) return [];
    const sums: Record<string, { sum: number; count: number }> = {};
    for (const m of modelNames) sums[m] = { sum: 0, count: 0 };
    for (const p of agreementMatrix) {
      sums[p.m1].sum += p.pct;
      sums[p.m1].count++;
      sums[p.m2].sum += p.pct;
      sums[p.m2].count++;
    }
    return modelNames.map((m) => ({
      name: m,
      avg: sums[m].count > 0 ? Math.round(sums[m].sum / sums[m].count) : 0,
    }));
  }, [agreementMatrix, modelNames]);

  const handleExport = useCallback(() => {
    if (results.length === 0) return;
    const header = ["Trace ID", "Model", ...probeLabels.flatMap((l) => [`${l} (Value)`, `${l} (Conf)`])];
    const lines: string[] = [];
    for (const tid of traceIds) {
      for (const mName of modelNames) {
        const cells = results.filter((r) => r.trace_id === tid && r.model === mName);
        if (cells.length === 0) continue;
        const row = [tid, mName];
        for (let pi = 0; pi < probes.length; pi++) {
          const c = cells.find((c) => c.probe_idx === pi);
          row.push(c?.value || "—");
          row.push(c?.confidence !== null && c?.confidence !== undefined ? c.confidence.toFixed(4) : "—");
        }
        lines.push(row.map((v) => `"${v}"`).join(","));
      }
    }
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `classify-${taskId || "analysis"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addToast("CSV exported", "success", 2000);
  }, [results, probeLabels, traceIds, modelNames, probes.length, taskId, addToast]);

  const handleCancel = useCallback(async () => {
    if (!taskId) return;
    pollRef.current?.stop();
    try {
      await apiPost(`/api/tests/classify/${taskId}/cancel`);
      addToastRef.current("Analysis stopped", "info", 2000);
    } catch {
      addToastRef.current("Failed to cancel", "error", 2000);
    }
  }, [taskId]);

  if (probes.length === 0 || models.length === 0) return null;

  const progress = totalCells > 0 ? Math.round((completedCells / totalCells) * 100) : 0;

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold tracking-[0.28em] uppercase text-teal-mystic/60">
          What-If Analysis — {modelNames.length} models × {traceIds.length} traces
          {wasCancelled && (
            <span className="ml-2 text-[9px] text-red/60 font-mono normal-case">(Stopped)</span>
          )}
        </div>
        {status === "done" && results.length > 0 && (
          <button
            onClick={handleExport}
            className="flex items-center gap-1 text-[10px] text-teal-mystic/60 hover:text-teal-mystic transition-colors font-mono"
          >
            <Download size={10} /> CSV
          </button>
        )}
      </div>

      {/* Progress — warmup or initial waiting phase */}
      {status === "running" && totalCells === 0 && (
        <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500 py-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-solar-gold animate-pulse" />
          {warmupStatus || "Loading traces and preparing prompts…"}
        </div>
      )}

      {/* Progress bar */}
      {status === "running" && totalCells > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
            <span className="flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-solar-gold animate-pulse" />
              {warmupStatus && warmupStatus !== "ready"
                ? warmupStatus
                : `Classifying ${totalCells} cells`
              }
            </span>
            <span className="flex items-center gap-3">
              <span>{completedCells}/{totalCells} ({progress}%)</span>
              <button
                onClick={handleCancel}
                className="text-[8px] uppercase tracking-wider text-red/60 hover:text-red transition-colors font-semibold"
              >
                Stop
              </button>
            </span>
          </div>
          <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-mystic/50 rounded-full transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[9px] font-mono">
            {modelNames.map((m) => {
              const done = results.filter((r) => r.model === m && !r.error).length;
              const errs = results.filter((r) => r.model === m && r.error).length;
              const total = totalCells / modelNames.length;
              return (
                <div key={m} className="contents">
                  <span className="text-zinc-600 truncate max-w-[140px]">{m}</span>
                  <span className="text-zinc-500">
                    {done + errs}/{total}
                    {errs > 0 && <span className="text-red/60 ml-1">({errs} err)</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="text-xs text-red/70 font-mono py-4 text-center">
          Classification task failed
        </div>
      )}

      {status === "done" && results.length === 0 && (
        <div className="text-xs text-zinc-600 font-mono py-4 text-center">
          No classification results returned
        </div>
      )}

      {/* Probe selector */}
      {results.length > 0 && probes.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          {probeLabels.map((label, pi) => (
            <button
              key={pi}
              onClick={() => setActiveProbeIdx(pi)}
              className={`text-[9px] font-mono px-2 py-1 rounded transition-colors ${
                pi === activeProbeIdx
                  ? "bg-teal-mystic/20 text-teal-mystic"
                  : "text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.04]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Matrix */}
      {results.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] font-mono border-collapse">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left text-zinc-500 font-semibold py-2 pr-2 whitespace-nowrap">Trace ID</th>
                {modelNames.map((mName) => (
                  <th key={mName} className="text-left text-zinc-500 font-semibold py-2 px-2 whitespace-nowrap">
                    {mName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {traceIds.map((tid) => {
                const disagree = disagreeRows.has(tid);
                return (
                  <tr
                    key={tid}
                    className={`border-b border-white/[0.03] transition-colors ${
                      disagree ? "bg-solar-gold/[0.04]" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <td className="py-2 pr-2">
                      <button
                        onClick={() => handleGenerateDoc(tid)}
                        className="text-teal-mystic/70 hover:text-teal-mystic truncate max-w-[72px] transition-colors text-left"
                        title="Click to download trace document"
                      >
                        {tid.slice(0, 8)}…
                      </button>
                    </td>
                    {modelNames.map((mName) => {
                      const cell = results.find(
                        (r) => r.trace_id === tid && r.model === mName && r.probe_idx === activeProbeIdx
                      );
                      const val = cell?.value || (status === "done" ? "—" : "…");
                      return (
                        <td key={`${tid}-${mName}`} className="px-2 py-2">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`truncate max-w-[130px] ${
                                cell?.error ? "text-red/60" : cell?.value ? "text-zinc-300" : "text-zinc-600"
                              }`}
                              title={cell?.error || val}
                            >
                              {val}
                            </span>
                            {cell?.confidence !== null && cell?.confidence !== undefined ? (
                              <span
                                className={`shrink-0 inline-block px-1 py-0.5 rounded text-[7px] font-semibold ${
                                  cell.confidence > 0.3
                                    ? "bg-teal-mystic/15 text-teal-mystic"
                                    : cell.confidence > 0.15
                                      ? "bg-solar-gold/15 text-solar-gold"
                                      : "bg-red/15 text-red/80"
                                }`}
                              >
                                {(cell.confidence * 100).toFixed(0)}%
                              </span>
                            ) : null}
                            {cell?.error && (
                              <span className="text-red/60 text-[7px]" title={cell.error}>⚠</span>
                            )}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Agreement matrix */}
      {results.length > 0 && agreementMatrix && agreementMatrix.length > 0 && (
        <div className="pt-2 space-y-2">
          <div className="text-[10px] font-semibold tracking-[0.28em] uppercase text-teal-mystic/60">
            Model Agreement
          </div>
          <div className="flex items-stretch gap-3">
            {/* Agreement grid */}
            <div
              className="grid gap-px bg-white/[0.04] rounded overflow-hidden"
              style={{
                gridTemplateColumns: `auto repeat(${modelNames.length}, 48px)`,
              }}
            >
              {/* Header row */}
              <div className="bg-glass-panel px-1.5 py-1 text-[7px] text-zinc-600 font-mono text-center" />
              {modelNames.map((m) => (
                <div
                  key={m}
                  className="bg-glass-panel px-1.5 py-1 text-[7px] text-zinc-500 font-mono truncate text-center"
                  title={m}
                >
                  {m.length > 10 ? m.slice(0, 8) + "…" : m}
                </div>
              ))}
              {/* Rows */}
              {modelNames.map((m1, i) => (
                <React.Fragment key={m1}>
                  <div
                    className="bg-glass-panel px-1.5 py-1 text-[7px] text-zinc-500 font-mono truncate text-right"
                    title={m1}
                  >
                    {m1.length > 12 ? m1.slice(0, 10) + "…" : m1}
                  </div>
                  {modelNames.map((m2, j) => {
                    const pair = i < j
                      ? agreementMatrix.find((p) => p.m1 === m1 && p.m2 === m2)
                      : i > j
                        ? agreementMatrix.find((p) => p.m1 === m2 && p.m2 === m1)
                        : null;
                    const pct = pair ? pair.pct : (i === j ? 100 : 0);
                    const tint = Math.round((pct / 100) * 80);
                    const cellBg = i === j
                      ? "bg-white/[0.03]"
                      : pair
                        ? `bg-teal-mystic/${tint}`
                        : "bg-white/[0.02]";
                    return (
                      <div
                        key={`${m1}-${m2}`}
                        className={`${cellBg} px-1.5 py-1 text-[9px] font-mono text-center leading-none`}
                        title={pair ? `${pair.match}/${pair.total} traces agree` : undefined}
                      >
                        {i === j ? (
                          <span className="text-zinc-600">—</span>
                        ) : pair ? (
                          <span className={`font-semibold ${pct >= 70 ? "text-teal-mystic" : pct >= 40 ? "text-solar-gold" : "text-red/70"}`}>
                            {pct}%
                          </span>
                        ) : (
                          <span className="text-zinc-700">·</span>
                        )}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>

            {/* Per-model average agreement */}
            <div className="space-y-1 self-center min-w-[80px]">
              {modelAvgAgreement.map((m) => {
                const tint = Math.round((m.avg / 100) * 80);
                return (
                  <div key={m.name} className="flex items-center gap-1.5 text-[9px] font-mono">
                    <span className="text-zinc-600 truncate max-w-[60px]" title={m.name}>
                      {m.name.length > 8 ? m.name.slice(0, 6) + "…" : m.name}
                    </span>
                    <div className="flex-1 h-2 bg-white/[0.04] rounded overflow-hidden">
                      <div
                        className="h-full rounded bg-teal-mystic/60 transition-all"
                        style={{ width: `${m.avg}%` }}
                      />
                    </div>
                    <span className="text-zinc-500 w-6 text-right">{m.avg}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
