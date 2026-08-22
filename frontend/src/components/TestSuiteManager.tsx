"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Play, Plus, Trash2, ChevronDown, ChevronUp, ExternalLink, RefreshCw } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface SuitePrompt {
  id: string;
  text: string;
  category: string;
  notes: string;
}

interface SuiteRun {
  run_id: string;
  models: { provider: string; model: string }[];
  status: string;
  started_at: string;
  completed_at: string | null;
  total: number;
  completed_count: number;
  failed_count: number;
  trace_ids: string[];
}

interface Suite {
  id: string;
  name: string;
  description: string;
  tags: string[];
  prompt_count: number;
  run_count: number;
  last_run: {
    run_id: string;
    status: string;
    completed_at: string;
    models: { provider: string; model: string }[];
  } | null;
  created_at: string;
  updated_at: string;
}

interface SuiteDetail extends Suite {
  prompts: SuitePrompt[];
  runs: SuiteRun[];
}

interface ModelOption {
  name: string;
  provider: "local" | "worker";
}

export default function TestSuiteManager() {
  const [suites, setSuites] = useState<Suite[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSuite, setExpandedSuite] = useState<string | null>(null);
  const [detail, setDetail] = useState<SuiteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create/edit state
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formTags, setFormTags] = useState("");
  const [formPrompts, setFormPrompts] = useState<{ text: string; category: string; notes: string }[]>([
    { text: "", category: "", notes: "" },
  ]);

  // Run state
  const [runModalSuite, setRunModalSuite] = useState<SuiteDetail | null>(null);
  const [allModels, setAllModels] = useState<ModelOption[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [loadingModels, setLoadingModels] = useState(false);
  const [running, setRunning] = useState(false);

  // Active run polling
  const [activeRun, setActiveRun] = useState<{ suiteId: string; runId: string } | null>(null);
  const [activeRunStatus, setActiveRunStatus] = useState<SuiteRun | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSuites = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/suites`);
      if (res.ok) setSuites(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchSuites(); }, [fetchSuites]);

  // Poll active run
  useEffect(() => {
    if (!activeRun) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/suites/${activeRun.suiteId}/runs/${activeRun.runId}`);
        if (res.ok) {
          const data: SuiteRun = await res.json();
          setActiveRunStatus(data);
          if (data.status === "done") {
            if (pollRef.current) clearInterval(pollRef.current);
            setActiveRun(null);
            fetchSuites();
            // Refresh detail if viewing this suite
            if (expandedSuite === activeRun.suiteId) loadDetail(activeRun.suiteId);
          }
        }
      } catch {}
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeRun, expandedSuite, fetchSuites]);

  const loadDetail = async (suiteId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/suites/${suiteId}`);
      if (res.ok) setDetail(await res.json());
    } catch {}
    setDetailLoading(false);
  };

  const toggleExpand = async (suiteId: string) => {
    if (expandedSuite === suiteId) {
      setExpandedSuite(null);
      setDetail(null);
    } else {
      setExpandedSuite(suiteId);
      await loadDetail(suiteId);
    }
  };

  const loadModels = async () => {
    setLoadingModels(true);
    try {
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
      const workerBaseNames = new Set<string>();
      for (const src of netData.sources ?? []) {
        for (const m of src.models ?? []) {
          workerSet.add(m);
          // Also track base names (strip node prefix and registry path) for matching
          // e.g. "backoffice/qwen3:latest" should match "docker.io/ai/qwen3:latest"
          const base = m.includes("/") ? m.split("/").pop()! : m;
          workerBaseNames.add(base);
        }
      }

      const detectProvider = (name: string): "local" | "worker" => {
        if (localSet.has(name)) return "local";
        if (workerSet.has(name)) return "worker";
        // Strip node prefix (e.g. "backoffice/" or "primary/") and check base name
        const base = name.includes("/") ? name.split("/").pop()! : name;
        if (workerBaseNames.has(base)) return "worker";
        return "local";
      };

      const seen = new Set<string>();
      const models: ModelOption[] = [];
      for (const t of traces) {
        const name: string = t.model_used;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        models.push({ name, provider: detectProvider(name) });
      }
      models.sort((a, b) => a.name.localeCompare(b.name));
      setAllModels(models);
      if (models.length > 0) setSelectedModels(new Set([models[0].name]));
    } catch {}
    setLoadingModels(false);
  };

  const handleCreate = async () => {
    if (!formName.trim()) return;
    const prompts = formPrompts.filter((p) => p.text.trim());
    const tags = formTags.split(",").map((t) => t.trim()).filter(Boolean);
    const body = { name: formName, description: formDesc, tags, prompts };
    if (editingId) {
      await fetch(`${API_BASE}/api/suites/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await fetch(`${API_BASE}/api/suites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    setCreating(false);
    setEditingId(null);
    setFormName("");
    setFormDesc("");
    setFormTags("");
    setFormPrompts([{ text: "", category: "", notes: "" }]);
    fetchSuites();
  };

  const handleDelete = async (suiteId: string) => {
    if (!confirm("Delete this suite and all its run history?")) return;
    await fetch(`${API_BASE}/api/suites/${suiteId}`, { method: "DELETE" });
    if (expandedSuite === suiteId) { setExpandedSuite(null); setDetail(null); }
    fetchSuites();
  };

  const startEdit = (suite: SuiteDetail) => {
    setEditingId(suite.id);
    setFormName(suite.name);
    setFormDesc(suite.description);
    setFormTags(suite.tags.join(", "));
    setFormPrompts(suite.prompts.map((p) => ({ text: p.text, category: p.category, notes: p.notes })));
    setCreating(true);
  };

  const openRunModal = async (suite: SuiteDetail) => {
    setRunModalSuite(suite);
    await loadModels();
  };

  const handleRun = async () => {
    if (!runModalSuite || selectedModels.size === 0) return;
    setRunning(true);
    const models = Array.from(selectedModels).map((name) => {
      const opt = allModels.find((m) => m.name === name);
      return { provider: opt?.provider ?? "local", model: name };
    });
    try {
      const res = await fetch(`${API_BASE}/api/suites/${runModalSuite.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveRun({ suiteId: runModalSuite.id, runId: data.run_id });
        setActiveRunStatus({
          run_id: data.run_id,
          models,
          status: "running",
          started_at: new Date().toISOString(),
          completed_at: null,
          total: (runModalSuite.prompts?.length ?? 0) * models.length,
          completed_count: 0,
          failed_count: 0,
          trace_ids: [],
        });
      }
    } catch {}
    setRunning(false);
    setRunModalSuite(null);
  };

  const fmtTime = (iso: string) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  const fmtDuration = (start: string, end: string | null) => {
    if (!end) return "running...";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex items-center gap-2 text-[9px] font-semibold tracking-widest uppercase">
        <span className="text-zinc-400">Test Suites</span>
        <button
          onClick={() => { setCreating(true); setEditingId(null); setFormName(""); setFormDesc(""); setFormTags(""); setFormPrompts([{ text: "", category: "", notes: "" }]); }}
          className="ml-auto text-[8px] font-mono text-teal-400/70 hover:text-teal-300 transition-colors flex items-center gap-1"
        >
          <Plus size={10} /> NEW SUITE
        </button>
      </div>

      {/* Create/Edit form */}
      {creating && (
        <div className="bg-white/[0.04] rounded-lg p-3 space-y-2 border border-white/[0.06]">
          <div className="flex items-center gap-2">
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Suite name"
              className="flex-1 bg-white/[0.06] border border-white/[0.08] rounded px-2 py-1 text-[10px] font-mono text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-teal-500/40"
            />
            <input
              value={formTags}
              onChange={(e) => setFormTags(e.target.value)}
              placeholder="tags (comma-separated)"
              className="w-40 bg-white/[0.06] border border-white/[0.08] rounded px-2 py-1 text-[10px] font-mono text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-teal-500/40"
            />
          </div>
          <input
            value={formDesc}
            onChange={(e) => setFormDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full bg-white/[0.06] border border-white/[0.08] rounded px-2 py-1 text-[10px] font-mono text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-teal-500/40"
          />
          <div className="space-y-1">
            <div className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider">Prompts</div>
            {formPrompts.map((p, i) => (
              <div key={i} className="flex gap-1.5">
                <input
                  value={p.text}
                  onChange={(e) => setFormPrompts((prev) => prev.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                  placeholder="Prompt text"
                  className="flex-1 bg-white/[0.06] border border-white/[0.08] rounded px-2 py-1 text-[10px] font-mono text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-teal-500/40"
                />
                <input
                  value={p.category}
                  onChange={(e) => setFormPrompts((prev) => prev.map((x, j) => j === i ? { ...x, category: e.target.value } : x))}
                  placeholder="category"
                  className="w-24 bg-white/[0.06] border border-white/[0.08] rounded px-2 py-1 text-[9px] font-mono text-zinc-400 placeholder:text-zinc-600 outline-none focus:border-teal-500/40"
                />
                {formPrompts.length > 1 && (
                  <button onClick={() => setFormPrompts((prev) => prev.filter((_, j) => j !== i))}
                    className="text-zinc-600 hover:text-red-400 px-1"><Trash2 size={10} /></button>
                )}
              </div>
            ))}
            <button
              onClick={() => setFormPrompts((prev) => [...prev, { text: "", category: "", notes: "" }])}
              className="text-[8px] font-mono text-zinc-600 hover:text-teal-400 transition-colors"
            >
              + add prompt
            </button>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleCreate}
              className="px-3 py-1 rounded bg-teal-500/20 text-teal-300 text-[9px] font-mono hover:bg-teal-500/30 transition-colors">
              {editingId ? "Save" : "Create"}
            </button>
            <button onClick={() => { setCreating(false); setEditingId(null); }}
              className="px-3 py-1 rounded text-zinc-500 text-[9px] font-mono hover:text-zinc-300 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Active run progress */}
      {activeRunStatus && (
        <div className="bg-teal-500/[0.06] border border-teal-500/20 rounded-lg p-3 space-y-1">
          <div className="text-[9px] font-mono text-teal-300">
            Running: {activeRunStatus.completed_count + activeRunStatus.failed_count}/{activeRunStatus.total} cells
            {activeRunStatus.failed_count > 0 && <span className="text-red-400"> ({activeRunStatus.failed_count} failed)</span>}
          </div>
          <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-teal-500/60 transition-all duration-500"
              style={{ width: `${activeRunStatus.total > 0 ? ((activeRunStatus.completed_count + activeRunStatus.failed_count) / activeRunStatus.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Suite cards */}
      {loading ? (
        <div className="text-[9px] font-mono text-zinc-600 py-2">Loading suites...</div>
      ) : suites.length === 0 ? (
        <div className="text-[9px] font-mono text-zinc-600 py-2">No suites yet. Create one to get started.</div>
      ) : (
        <div className="space-y-1.5">
          {suites.map((suite) => (
            <div key={suite.id} className="bg-white/[0.03] rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 hover:bg-white/[0.04] transition-colors cursor-pointer"
                onClick={() => toggleExpand(suite.id)}>
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500/40 shrink-0" />
                <span className="text-[10px] font-mono text-zinc-200 truncate flex-1">{suite.name}</span>
                <span className="text-[8px] font-mono text-zinc-600">{suite.prompt_count} prompts</span>
                {suite.last_run && (
                  <span className={`text-[8px] font-mono ${suite.last_run.status === "done" ? "text-emerald-500/70" : "text-amber-400/70"}`}>
                    {suite.run_count} run{suite.run_count !== 1 ? "s" : ""}
                  </span>
                )}
                {expandedSuite === suite.id ? <ChevronUp size={12} className="text-zinc-600" /> : <ChevronDown size={12} className="text-zinc-600" />}
              </div>

              {expandedSuite === suite.id && detail && (
                <div className="px-3 pb-3 space-y-2 border-t border-white/[0.04]">
                  {detail.description && (
                    <div className="text-[8px] font-mono text-zinc-500 pt-2 leading-relaxed">{detail.description}</div>
                  )}
                  {detail.tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {detail.tags.map((t) => (
                        <span key={t} className="text-[7px] font-mono text-zinc-500 bg-white/[0.05] px-1.5 py-0.5 rounded">{t}</span>
                      ))}
                    </div>
                  )}

                  {/* Prompts */}
                  <div className="space-y-0.5">
                    <div className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider">Prompts</div>
                    {detail.prompts.map((p, i) => (
                      <div key={p.id} className="flex gap-2 text-[9px] font-mono py-0.5">
                        <span className="text-zinc-600 w-4 text-right shrink-0">{i + 1}</span>
                        <span className="text-zinc-300 flex-1 truncate">{p.text}</span>
                        {p.category && <span className="text-zinc-600 shrink-0">{p.category}</span>}
                      </div>
                    ))}
                  </div>

                  {/* Run history */}
                  {detail.runs.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider">Run History</div>
                      {[...detail.runs].reverse().map((run) => (
                        <div key={run.run_id} className="flex items-center gap-2 text-[8px] font-mono py-0.5">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${run.status === "done" ? "bg-emerald-500/60" : "bg-amber-400/60"}`} />
                          <span className="text-zinc-400">{fmtTime(run.started_at)}</span>
                          <span className="text-zinc-500">{run.completed_count}/{run.total} ok</span>
                          {run.failed_count > 0 && <span className="text-red-400/70">{run.failed_count} fail</span>}
                          <span className="text-zinc-600">{fmtDuration(run.started_at, run.completed_at)}</span>
                          <span className="text-zinc-600">{run.models.map((m) => m.model).join(", ")}</span>
                          {run.status === "done" && run.trace_ids.length > 0 && (
                            <span className="text-zinc-600">
                              {run.trace_ids.length} trace{run.trace_ids.length !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => openRunModal(detail)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-teal-500/15 text-teal-300 text-[9px] font-mono hover:bg-teal-500/25 transition-colors">
                      <Play size={10} /> Run
                    </button>
                    <button onClick={() => startEdit(detail)}
                      className="px-2.5 py-1 rounded text-zinc-500 text-[9px] font-mono hover:text-zinc-300 transition-colors">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(detail.id)}
                      className="px-2.5 py-1 rounded text-zinc-600 text-[9px] font-mono hover:text-red-400 transition-colors">
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Run modal */}
      {runModalSuite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setRunModalSuite(null)}>
          <div className="bg-zinc-900 border border-white/[0.1] rounded-xl p-4 w-[360px] space-y-3"
            onClick={(e) => e.stopPropagation()}>
            <div className="text-[10px] font-mono text-zinc-300">
              Run <span className="text-teal-300">{runModalSuite.name}</span> ({runModalSuite.prompts?.length ?? 0} prompts)
            </div>
            {loadingModels ? (
              <div className="text-[9px] font-mono text-zinc-600">Discovering models...</div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider">Select models</div>
                  <button
                    onClick={loadModels}
                    className="flex items-center gap-1 text-[8px] font-mono text-zinc-600 hover:text-teal-400 transition-colors"
                    title="Refresh model list — discovers models from trace history, local Ollama/llama.cpp, and network workers"
                  >
                    <RefreshCw size={9} className={loadingModels ? "animate-spin" : ""} />
                    refresh
                  </button>
                </div>
                <div className="text-[8px] font-mono text-zinc-700 leading-relaxed">
                  Models appear from trace history, local runners (Ollama, llama.cpp), and network workers. Pull or load a model on any node, then refresh to see it.
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {allModels.map((m) => (
                    <button
                      key={m.name}
                      onClick={() => setSelectedModels((prev) => {
                        const next = new Set(prev);
                        if (next.has(m.name)) next.delete(m.name); else next.add(m.name);
                        return next;
                      })}
                      className={`px-2 py-0.5 rounded text-[9px] font-mono transition-colors ${
                        selectedModels.has(m.name)
                          ? "bg-teal-500/20 text-teal-300 border border-teal-500/30"
                          : "bg-white/[0.04] text-zinc-500 border border-white/[0.06] hover:text-zinc-300"
                      }`}
                    >
                      {m.name}
                      {m.provider === "worker" && <span className="text-amber-400/60 ml-1">worker</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={handleRun} disabled={running || selectedModels.size === 0}
                className="flex items-center gap-1 px-3 py-1 rounded bg-teal-500/20 text-teal-300 text-[9px] font-mono hover:bg-teal-500/30 transition-colors disabled:opacity-40">
                <Play size={10} /> {running ? "Starting..." : "Run Suite"}
              </button>
              <button onClick={() => setRunModalSuite(null)}
                className="px-3 py-1 rounded text-zinc-500 text-[9px] font-mono hover:text-zinc-300 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
