"use client";

import { Play, Plus, X } from "lucide-react";
import { useState, useCallback, useEffect } from "react";
import type { Probe, ProbeAttribute, ProbeArtefact } from "@/types/trace";
import { PROBE_ATTRIBUTE_LABELS, PROBE_ARTEFACT_OPTIONS } from "@/types/trace";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const ATTRIBUTES = Object.keys(PROBE_ATTRIBUTE_LABELS) as ProbeAttribute[];

interface ModelOption {
  name: string;
  provider: "local" | "worker";
}

interface Props {
  onRun: (probes: Probe[], models: ModelOption[]) => void;
  hasResults: boolean;
}

export default function TestRunner({ onRun, hasResults }: Props) {
  const [probes, setProbes] = useState<Probe[]>([
    { action: "classify", attribute: "ddc", artefact: "prompt" },
  ]);
  const [allModels, setAllModels] = useState<ModelOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingModels, setLoadingModels] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingModels(true);
      // Fetch model names from traces
      const [traceRes, localRes, netRes] = await Promise.all([
        fetch(`${API_BASE}/api/traces?limit=200`),
        fetch(`${API_BASE}/api/models`),
        fetch(`${API_BASE}/api/models/network`),
      ]);
      const traces: any[] = traceRes.ok ? await traceRes.json() : [];
      const localModels: string[] = localRes.ok
        ? (await localRes.json()).models ?? []
        : [];
      const netData: { sources: any[] } = netRes.ok ? await netRes.json() : { sources: [] };

      const localSet = new Set(localModels);
      // Collect worker model names from network sources
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

      // Unique model_used values from traces
      const seen = new Set<string>();
      const models: ModelOption[] = [];
      for (const t of traces) {
        const name: string = t.model_used;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        models.push({ name, provider: detectProvider(name) });
      }
      models.sort((a, b) => a.name.localeCompare(b.name));
      if (!cancelled) {
        setAllModels(models);
        setLoadingModels(false);
        if (models.length > 0) setSelected(new Set([models[0].name]));
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const updateProbe = useCallback((idx: number, field: "attribute" | "artefact", value: string) => {
    setProbes((prev) => prev.map((p, i) => {
      if (i !== idx) return p;
      if (field === "attribute") {
        const attr = value as ProbeAttribute;
        const valid = PROBE_ARTEFACT_OPTIONS[attr];
        return { ...p, attribute: attr, artefact: valid[0] };
      }
      return { ...p, artefact: value as ProbeArtefact };
    }));
  }, []);

  const addSecondProbe = useCallback(() => {
    if (probes.length >= 2) return;
    setProbes((current) => {
      const second: Probe = {
        action: "classify",
        attribute: current[0].attribute,
        artefact: current[0].attribute === "ddc" || current[0].attribute === "lcc"
          ? (current[0].artefact === "prompt" ? "response" : "prompt")
          : current[0].artefact,
      };
      return [...current, second];
    });
  }, [probes.length]);

  const removeSecondProbe = useCallback(() => {
    setProbes([probes[0]]);
  }, [probes]);

  const toggleModel = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleRun = useCallback(() => {
    const models = allModels.filter((m) => selected.has(m.name));
    onRun(probes, models);
  }, [probes, allModels, selected, onRun]);

  return (
    <div className="glass-panel p-5 space-y-4">
      <div className="text-[11px] font-semibold tracking-[0.28em] uppercase text-teal-mystic/60">
        Test Builder
      </div>

      {/* Probe builder */}
      <div className="space-y-1.5">
        <span className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">Probes</span>

        {probes.map((probe, idx) => (
          <div key={idx}>
            {idx === 1 && (
              <div className="flex items-center gap-2 py-1">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="text-[10px] font-mono font-semibold text-teal-mystic/70 tracking-widest uppercase">AND</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[11px] font-mono">
              <select
                value={probe.action}
                disabled
                className="bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1.5 text-zinc-500
                  focus:outline-none cursor-not-allowed opacity-60"
              >
                <option value="classify">Classify</option>
              </select>
              <select
                value={probe.attribute}
                onChange={(e) => updateProbe(idx, "attribute", e.target.value)}
                className="bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1.5 text-zinc-300
                  focus:outline-none focus:border-teal-mystic/30 cursor-pointer min-w-[130px]"
              >
                {ATTRIBUTES.map((attr) => (
                  <option key={attr} value={attr}>{PROBE_ATTRIBUTE_LABELS[attr]}</option>
                ))}
              </select>
              <select
                value={probe.artefact}
                onChange={(e) => updateProbe(idx, "artefact", e.target.value)}
                className="bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1.5 text-zinc-300
                  focus:outline-none focus:border-teal-mystic/30 cursor-pointer"
              >
                {PROBE_ARTEFACT_OPTIONS[probe.attribute].map((art) => (
                  <option key={art} value={art}>of {art === "prompt" ? "Prompt" : "Output"}</option>
                ))}
              </select>
              {idx === 1 && (
                <button
                  onClick={removeSecondProbe}
                  className="text-zinc-600 hover:text-red/70 transition-colors ml-1"
                  title="Remove probe"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        ))}

        {probes.length < 2 && (
          <button
            onClick={addSecondProbe}
            className="flex items-center gap-1 text-[10px] font-mono text-zinc-500 hover:text-teal-mystic transition-colors"
          >
            <Plus size={10} />
            AND
          </button>
        )}
      </div>

      {/* Model selection */}
      <div className="space-y-1.5">
        <span className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">
          Classifying Models
        </span>
        {loadingModels ? (
          <div className="text-[10px] text-zinc-600 font-mono">Loading available models…</div>
        ) : allModels.length === 0 ? (
          <div className="text-[10px] text-zinc-600 font-mono">No models found in trace history</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {allModels.map((m) => {
              const active = selected.has(m.name);
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
                    m.provider === "worker"
                      ? "bg-amber/10 text-amber/60"
                      : "bg-teal-mystic/10 text-teal-mystic/50"
                  }`}>
                    {m.provider}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Explanation */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3 space-y-1.5">
        <p className="text-[10px] text-zinc-400 font-mono leading-relaxed">
          Each selected model reads every trace&apos;s text and <span className="text-zinc-300">classifies it from scratch</span>
          &nbsp;using the probes above. Results are ephemeral — existing traces are not modified.
        </p>
        <p className="text-[10px] text-zinc-500 font-mono leading-relaxed">
          A matrix is built showing what each model would classify each prompt or output as,
          letting you compare how different models interpret the same data side by side.
        </p>
      </div>

      <button
        onClick={handleRun}
        disabled={selected.size === 0}
        className="w-full px-4 py-2.5 rounded-lg text-[11px] font-semibold tracking-wider uppercase
          bg-teal-mystic/10 text-teal-mystic border border-teal-mystic/20
          hover:bg-teal-mystic/20 transition-colors
          disabled:opacity-30 disabled:cursor-not-allowed
          flex items-center justify-center gap-2"
      >
        <Play size={12} />
        Run Analysis
      </button>
    </div>
  );
}
