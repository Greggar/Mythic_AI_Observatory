"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Save, Server, Wifi, Cpu, RefreshCw, Plus, Trash2, Check, AlertTriangle, FileText, Search } from "lucide-react";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import type { TraceSummary } from "@/types/trace";

interface ServiceConfig {
  label: string;
  host: string;
  port: number;
  model?: string;
  protocol?: "ollama" | "openai";
  enabled?: boolean;
}

interface MachineConfig {
  name: string;
  host: string;
  desc: string;
  insight: string;
  services?: string[];
}

interface NetworkConfig {
  services: Record<string, ServiceConfig>;
  machines: Record<string, MachineConfig>;
  mask_ips?: boolean;
  analysis?: { model?: string; provider?: string };
  classifier?: { model?: string; poll_interval?: number };
  embeddings?: { model?: string; cache_dir?: string; url?: string };
  model_provider?: { provider?: string; model?: string };
}

interface DiscoveredService {
  type: "ollama" | "docker_model_runner" | "vllm" | "observatory";
  port: number;
  protocol?: "ollama" | "openai";
  models?: string[];
  info?: Record<string, string>;
}

interface DiscoveredMachine {
  ip: string;
  hostname: string | null;
  services: DiscoveredService[];
}

function maskIp(ip: string): string {
  if (!ip || ip === "127.0.0.1" || ip === "localhost") return ip;
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.x.xxx`;
  return ip;
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [config, setConfig] = useState<NetworkConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<"services" | "machines" | "models" | "delete" | "schema">("services");
  const [modelProvider, setModelProvider] = useState<string>("local");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState<string>("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [analysisModel, setAnalysisModel] = useState<string>("qwen2.5:3b");
  const [analysisProvider, setAnalysisProvider] = useState<string>("local");
  const [analysisNetworkSourceId, setAnalysisNetworkSourceId] = useState("");
  const [analysisNetworkModelName, setAnalysisNetworkModelName] = useState("");
  const [analysisModelSaved, setAnalysisModelSaved] = useState(false);
  const [modelSaved, setModelSaved] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [networkSources, setNetworkSources] = useState<{ id: string; label: string; host: string; port: number; configured_model: string; models: string[]; error: string | null }[]>([]);
  const [networkSourceId, setNetworkSourceId] = useState("");
  const [networkModelName, setNetworkModelName] = useState("");
  const [savedWorkerModel, setSavedWorkerModel] = useState("");
  const [networkSourcesLoading, setNetworkSourcesLoading] = useState(false);
  const [netModelSaved, setNetModelSaved] = useState(false);
  const [deleteTabReady, setDeleteTabReady] = useState(false);
  const [deleteCriteria, setDeleteCriteria] = useState<"all" | "model" | "ddc">("all");
  const [deleteModel, setDeleteModel] = useState("");
  const [deleteDdc, setDeleteDdc] = useState("0");
  const [deletePreviewCount, setDeletePreviewCount] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);
  const [allTraceMeta, setAllTraceMeta] = useState<{ id: string; model_used?: string | null; ddc_prompt?: string | null }[]>([]);
  const [schemaContent, setSchemaContent] = useState("");
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaSaved, setSchemaSaved] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [discoveredMachines, setDiscoveredMachines] = useState<DiscoveredMachine[]>([]);
  const [scanningNetwork, setScanningNetwork] = useState(false);
  const [scanError, setScanError] = useState("");
  const delModels = useMemo(() => {
    const s = new Set<string>();
    for (const t of allTraceMeta) if (t.model_used) s.add(t.model_used);
    return Array.from(s).sort();
  }, [allTraceMeta]);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<NetworkConfig>("/api/network-config");
      setConfig(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchModelProvider = useCallback(async () => {
    try {
      const data = await apiGet<{ provider?: string; model?: string }>("/api/config/model");
      setModelProvider(data.provider || "local");
      if (data.provider === "local" && data.model) {
        setCurrentModel(data.model);
      } else if (data.provider === "worker" && data.model) {
        setSavedWorkerModel(data.model);
      }
    } catch {
      // silently fail
    }
  }, []);

  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const [list, cur, analysisData] = await Promise.all([
        apiGet<{ models?: string[] }>("/api/models"),
        apiGet<{ model?: string }>("/api/models/current"),
        apiGet<{ model?: string; provider?: string }>("/api/config/analysis-model"),
      ]);
      if (list.models) setAvailableModels(list.models);
      if (cur.model) setCurrentModel(cur.model);
      if (analysisData.model) setAnalysisModel(analysisData.model);
      if (analysisData.provider) setAnalysisProvider(analysisData.provider);
    } catch {
      // silently fail
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const fetchNetworkSources = useCallback(async () => {
    if (networkSources.length > 0) return;
    setNetworkSourcesLoading(true);
    try {
      const data = await apiGet<{ sources?: { id: string; label: string; host: string; port: number; configured_model: string; models: string[]; error: string | null }[] }>("/api/models/network");
      if (data.sources) {
        setNetworkSources(data.sources);
        if (data.sources.length > 0 && !networkSourceId) {
          setNetworkSourceId(data.sources[0].id);
          setNetworkModelName(data.sources[0].configured_model);
        }
      }
    } catch {
      // silently fail
    } finally {
      setNetworkSourcesLoading(false);
    }
  }, [networkSources.length, networkSourceId]);

  const fetchSchema = useCallback(async () => {
    setSchemaLoading(true);
    setSchemaError(null);
    try {
      const data = await apiGet<{ content?: string }>("/api/schema");
      setSchemaContent(data.content || "");
    } catch (e) {
      setSchemaError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSchemaLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchConfig();
      fetchModelProvider();
      fetchModels();
      fetchNetworkSources();
      setSaved(false);
      setModelSaved(false);
      setDeleteTabReady(false);
      setDeleteConfirm(false);
      setDeleteResult(null);
      setAnalysisNetworkSourceId("");
      setAnalysisNetworkModelName("");
    }
  }, [open, fetchConfig, fetchModelProvider, fetchModels, fetchNetworkSources]);

  useEffect(() => {
    if (!open || tab !== "delete" || deleteTabReady) return;
    (async () => {
      try {
        const all: TraceSummary[] = await apiGet<TraceSummary[]>("/api/traces?limit=500&view=summary");
        setAllTraceMeta(all.map((t) => ({ id: t.id, model_used: t.model_used, ddc_prompt: t.ddc?.prompt?.code })));
        setDeleteTabReady(true);
      } catch { /* ignore */ }
    })();
  }, [open, tab, deleteTabReady]);

  useEffect(() => {
    if (!open || tab !== "models") return;
    fetchNetworkSources();
  }, [open, tab, fetchNetworkSources]);

  // Restore saved worker model selection after network sources load
  useEffect(() => {
    if (!savedWorkerModel || networkSources.length === 0) return;
    let found = false;
    for (const src of networkSources) {
      if (src.models.includes(savedWorkerModel) || src.configured_model === savedWorkerModel) {
        setNetworkSourceId(src.id);
        setNetworkModelName(savedWorkerModel);
        found = true;
        break;
      }
    }
    if (!found) {
      setNetworkModelName(savedWorkerModel);
    }
    setSavedWorkerModel("");
  }, [savedWorkerModel, networkSources]);

  useEffect(() => {
    if (networkSources.length === 0 || analysisNetworkSourceId) return;
    if (analysisProvider !== "worker") return;
    let found = false;
    for (const src of networkSources) {
      if (src.models.includes(analysisModel)) {
        setAnalysisNetworkSourceId(src.id);
        setAnalysisNetworkModelName(analysisModel);
        found = true;
        break;
      }
    }
    if (!found) {
      const fallbackModel = networkSources[0].models[0] || networkSources[0].configured_model;
      setAnalysisNetworkSourceId(networkSources[0].id);
      setAnalysisNetworkModelName(fallbackModel);
      setAnalysisModel(fallbackModel);
    }
  }, [networkSources, analysisProvider, analysisNetworkSourceId]);

  useEffect(() => {
    if (!deleteTabReady) return;
    let ids: string[] = allTraceMeta.map((t) => t.id);
    if (deleteCriteria === "model") {
      ids = allTraceMeta.filter((t) => t.model_used === deleteModel).map((t) => t.id);
    } else if (deleteCriteria === "ddc") {
      ids = allTraceMeta.filter((t) => t.ddc_prompt?.[0] === deleteDdc).map((t) => t.id);
    }
    setDeletePreviewCount(ids.length);
    setDeleteConfirm(false);
    setDeleteResult(null);
  }, [deleteTabReady, deleteCriteria, deleteModel, deleteDdc, allTraceMeta]);

  const updateService = (id: string, field: string, value: string | number | boolean) => {
    if (!config) return;
    setConfig({
      ...config,
      services: {
        ...config.services,
        [id]: { ...config.services[id], [field]: value },
      },
    });
  };

  const addService = () => {
    if (!config) return;
    const id = `svc-${Date.now()}`;
    setConfig({
      ...config,
      services: {
        ...config.services,
        [id]: { label: "", host: "", port: 0, model: "", enabled: true },
      },
    });
  };

  const removeService = (id: string) => {
    if (!config) return;
    const next = { ...config.services };
    delete next[id];
    setConfig({ ...config, services: next });
  };

  const updateMachine = (id: string, field: string, value: string) => {
    if (!config) return;
    setConfig({
      ...config,
      machines: {
        ...config.machines,
        [id]: { ...config.machines[id], [field]: value },
      },
    });
  };

  const addMachine = () => {
    if (!config) return;
    const id = `machine-${Date.now()}`;
    setConfig({
      ...config,
      machines: {
        ...config.machines,
        [id]: { name: "", host: "", desc: "", insight: "", services: [] },
      },
    });
  };

  const removeMachine = (id: string) => {
    if (!config) return;
    const next = { ...config.machines };
    delete next[id];
    setConfig({ ...config, machines: next });
  };

  const scanNetwork = useCallback(async () => {
    setScanningNetwork(true);
    setScanError("");
    try {
      const data = await apiPost<{ machines?: DiscoveredMachine[]; error?: string }>("/api/network/scan", {});
      if (data.error) setScanError(data.error);
      setDiscoveredMachines(data.machines || []);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanningNetwork(false);
    }
  }, []);

  const addMachineFromDiscovery = (machine: DiscoveredMachine) => {
    if (!config) return;
    const id = `machine-${Date.now()}`;
    const ollamaSvc = machine.services.find((s) => s.type === "ollama" || s.type === "docker_model_runner" || s.type === "vllm");
    const obsSvc = machine.services.find((s) => s.type === "observatory");
    const svcIds: string[] = [];
    if (ollamaSvc) svcIds.push("worker_llm");
    if (obsSvc) svcIds.push("openclaw");

    // Update service entries with actual discovered host/port/enable
    const updatedServices = { ...config.services };
    if (ollamaSvc && updatedServices.worker_llm) {
      updatedServices.worker_llm = {
        ...updatedServices.worker_llm,
        host: machine.ip,
        port: ollamaSvc.port,
        enabled: true,
        protocol: ollamaSvc.protocol || "ollama",
      };
    }

    setConfig({
      ...config,
      services: updatedServices,
      machines: {
        ...config.machines,
        [id]: {
          name: machine.hostname || machine.ip,
          host: machine.ip,
          desc: ollamaSvc
            ? `Ollama${ollamaSvc.models?.length ? ` (${ollamaSvc.models.length} models)` : ""}`
            : "Observatory instance",
          insight: "",
          services: svcIds,
        },
      },
    });
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const resolvedModel = analysisProvider === "worker" && analysisNetworkModelName
        ? analysisNetworkModelName
        : analysisModel;
      const mergedConfig = {
        ...config,
        model_provider: {
          provider: modelProvider,
          model: modelProvider === "worker" ? networkModelName : currentModel,
        },
        analysis: { model: resolvedModel, provider: analysisProvider },
      };
      await apiPut(`/api/network-config`, { config: mergedConfig });
      setSaved(true);
      setTimeout(() => onClose(), 1200);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            className="glass-panel w-full max-w-2xl max-h-[85vh] flex flex-col mx-4 overflow-hidden"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-3">
                <Server className="w-5 h-5 text-teal-mystic" />
                <h2 className="text-lg font-semibold text-white">Network Settings</h2>
              </div>
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 px-6 pt-4 pb-2 border-b border-white/[0.04] shrink-0">
              <button
                onClick={() => setTab("services")}
                className={`px-4 py-1.5 text-sm rounded-full transition-colors ${
                  tab === "services"
                    ? "bg-teal-mystic/20 text-teal-mystic border border-teal-mystic/30"
                    : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                }`}
              >
                <Wifi className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                Services
              </button>
              <button
                onClick={() => setTab("machines")}
                className={`px-4 py-1.5 text-sm rounded-full transition-colors ${
                  tab === "machines"
                    ? "bg-teal-mystic/20 text-teal-mystic border border-teal-mystic/30"
                    : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                }`}
              >
                <Server className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                Machines
              </button>
              <button
                onClick={() => setTab("models")}
                className={`px-4 py-1.5 text-sm rounded-full transition-colors ${
                  tab === "models"
                    ? "bg-teal-mystic/20 text-teal-mystic border border-teal-mystic/30"
                    : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                }`}
              >
                <Cpu className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                Models
              </button>
              <button
                onClick={() => {
                  setTab("delete");
                }}
                className={`px-4 py-1.5 text-sm rounded-full transition-colors ${
                  tab === "delete"
                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                    : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                }`}
              >
                <Trash2 className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                Delete
              </button>
              <button
                onClick={() => {
                  setTab("schema");
                  fetchSchema();
                }}
                className={`px-4 py-1.5 text-sm rounded-full transition-colors ${
                  tab === "schema"
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                    : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                }`}
              >
                <FileText className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                Schema
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 scrollbar-thin">
              {loading && (
                <div className="flex items-center justify-center py-12 text-zinc-500">
                  <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                  Loading config...
                </div>
              )}

              {!loading && tab === "services" && config && (
                <div className="space-y-3">
                  {Object.entries(config.services).map(([id, svc]) => (
                    <div key={id} className="glass-panel !rounded-xl p-4 space-y-2 relative">
                      <button
                        onClick={() => removeService(id)}
                        className="absolute top-3 right-3 text-zinc-600 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <input
                        type="text"
                        value={svc.label}
                        onChange={(e) => updateService(id, "label", e.target.value)}
                        className="w-full bg-transparent text-xs font-semibold text-teal-mystic uppercase tracking-wider mb-2 focus:outline-none border-b border-transparent focus:border-teal-mystic/30 transition-colors"
                        placeholder="Service Name"
                      />
                      <div className="grid grid-cols-[1fr_auto] gap-3">
                        <div>
                          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Host</label>
                          <input
                            type="text"
                            value={config?.mask_ips && focusedField !== `svc-${id}` ? maskIp(svc.host) : svc.host}
                            onChange={(e) => updateService(id, "host", e.target.value)}
                            onFocus={() => setFocusedField(`svc-${id}`)}
                            onBlur={() => setFocusedField(null)}
                            className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
                          />
                        </div>
                        <div className="w-24">
                          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Port</label>
                          <input
                            type="number"
                            value={svc.port}
                            onChange={(e) => updateService(id, "port", Number(e.target.value))}
                            className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
                          />
                        </div>
                      </div>
                      {"model" in svc && (
                        <div>
                          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Model</label>
                          <input
                            type="text"
                            value={svc.model || ""}
                            onChange={(e) => updateService(id, "model", e.target.value)}
                            className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={addService}
                    className="w-full py-2.5 border border-dashed border-white/[0.08] rounded-xl text-sm text-zinc-500 hover:text-teal-mystic hover:border-teal-mystic/30 transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Service
                  </button>
                </div>
              )}

              {!loading && tab === "machines" && config && (
                <div className="space-y-3">
                  {Object.entries(config.machines).map(([id, m]) => (
                    <div key={id} className="glass-panel !rounded-xl p-4 space-y-2 relative">
                      <button
                        onClick={() => removeMachine(id)}
                        className="absolute top-3 right-3 text-zinc-600 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Machine ID</label>
                          <div className="text-xs text-zinc-600 font-mono mt-0.5">{id}</div>
                        </div>
                        <div>
                          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Name</label>
                          <input
                            type="text"
                            value={m.name}
                            onChange={(e) => updateMachine(id, "name", e.target.value)}
                            className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Host IP</label>
                        <input
                          type="text"
                          value={config?.mask_ips && focusedField !== `mch-${id}` ? maskIp(m.host) : m.host}
                          onChange={(e) => updateMachine(id, "host", e.target.value)}
                          onFocus={() => setFocusedField(`mch-${id}`)}
                          onBlur={() => setFocusedField(null)}
                          className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Description</label>
                        <input
                          type="text"
                          value={m.desc}
                          onChange={(e) => updateMachine(id, "desc", e.target.value)}
                          className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Insight</label>
                        <input
                          type="text"
                          value={m.insight}
                          onChange={(e) => updateMachine(id, "insight", e.target.value)}
                          className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
                        />
                      </div>
                    </div>
                  ))}
                  {/* Discovered machines */}
                  {discoveredMachines.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Discovered on network</label>
                      {discoveredMachines.map((m) => {
                        const alreadyAdded = config?.machines && Object.values(config.machines).some((mc) => mc.host === m.ip);
                        const svc = m.services.find((s) => s.type === "ollama" || s.type === "docker_model_runner" || s.type === "vllm");
                        return (
                          <button
                            key={m.ip}
                            onClick={() => !alreadyAdded && addMachineFromDiscovery(m)}
                            disabled={alreadyAdded}
                            className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors flex items-center justify-between ${
                              alreadyAdded
                                ? "bg-teal-mystic/10 border-teal-mystic/20 text-teal-mystic/60"
                                : "bg-black/20 border-white/[0.06] text-zinc-400 hover:border-teal-mystic/30 hover:text-teal-mystic"
                            }`}
                          >
                            <span>
                              <span className="font-mono">{m.ip}</span>
                              {m.hostname && <span className="text-zinc-600 ml-1.5">({m.hostname})</span>}
                            </span>
                            <span className="text-[10px] text-zinc-600">
                              {alreadyAdded ? "added" : svc ? `${svc.models?.length || 0} models` : "observatory"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex gap-2">
                    {discoveredMachines.length === 0 && !scanningNetwork && (
                      <button
                        onClick={scanNetwork}
                        className="flex-1 py-2.5 border border-dashed border-white/[0.08] rounded-xl text-sm text-zinc-500 hover:text-teal-mystic hover:border-teal-mystic/30 transition-colors flex items-center justify-center gap-2"
                      >
                        <Search className="w-4 h-4" />
                        Scan Network
                      </button>
                    )}
                    <button
                      onClick={addMachine}
                      className={`${discoveredMachines.length === 0 && !scanningNetwork ? "flex-1" : "w-full"} py-2.5 border border-dashed border-white/[0.08] rounded-xl text-sm text-zinc-500 hover:text-teal-mystic hover:border-teal-mystic/30 transition-colors flex items-center justify-center gap-2`}
                    >
                      <Plus className="w-4 h-4" />
                      Add Manually
                    </button>
                  </div>
                  {scanningNetwork && (
                    <div className="flex items-center justify-center gap-2 text-xs text-zinc-500 py-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Scanning subnet...
                    </div>
                  )}
                  {scanError && <p className="text-[10px] text-red-400/80">{scanError}</p>}
                </div>
              )}

              {!loading && tab === "models" && (
                <div className="space-y-4">
                  {/* Inference Provider */}
                  <div className="glass-panel !rounded-xl p-4">
                    <div className="text-xs font-semibold text-teal-mystic uppercase tracking-wider mb-3">
                      Inference Provider
                    </div>
                    <p className="text-[11px] text-zinc-500 mb-4">
                      Choose where model inference runs. Changes take effect on the next orchestration.
                    </p>
                    <div className="space-y-2">
                      <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        modelProvider === "local"
                          ? "border-teal-mystic/40 bg-teal-mystic/5"
                          : "border-white/[0.06] bg-black/20 hover:border-white/[0.12]"
                      }`}>
                        <input
                          type="radio"
                          name="provider"
                          value="local"
                          checked={modelProvider === "local"}
                          onChange={() => setModelProvider("local")}
                          className="accent-teal-mystic"
                        />
                        <div className="flex-1">
                          <div className="text-sm text-zinc-200 font-medium">Local (CPU)</div>
                          {modelProvider === "local" && (
                            <select
                              value={currentModel}
                              onChange={async (e) => {
                                setCurrentModel(e.target.value);
                                setModelSaved(false);
                                try {
                                  await apiPost(`/api/models/select`, { model: e.target.value });
                                  setModelSaved(true);
                                  setTimeout(() => setModelSaved(false), 2000);
                                } catch { /* ignore */ }
                              }}
                              className="mt-2 w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
                            >
                              {modelsLoading ? (
                                <option>Loading...</option>
                              ) : availableModels.length === 0 ? (
                                <option>No models found</option>
                              ) : (
                                availableModels.map((m) => (
                                  <option key={m} value={m}>{m}</option>
                                ))
                              )}
                            </select>
                          )}
                          {modelProvider !== "local" && (
                            <div className="text-[10px] text-zinc-500 mt-1">Click to select and configure local model</div>
                          )}
                        </div>
                      </label>
                      <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        modelProvider === "worker"
                          ? "border-teal-mystic/40 bg-teal-mystic/5"
                          : "border-white/[0.06] bg-black/20 hover:border-white/[0.12]"
                      }`}>
                        <input
                          type="radio"
                          name="provider"
                          value="worker"
                          checked={modelProvider === "worker"}
                          onChange={() => setModelProvider("worker")}
                          className="accent-teal-mystic mt-1"
                        />
                        <div className="flex-1 space-y-2">
                          <div className="text-sm text-zinc-200 font-medium">Network Source</div>
                          {modelProvider === "worker" ? (
                            <>
                              <div className="flex gap-2">
                                <select
                                  value={networkSourceId}
                                  onChange={(e) => {
                                    const src = networkSources.find((s) => s.id === e.target.value);
                                    setNetworkSourceId(e.target.value);
                                    if (src) {
                                      setNetworkModelName(
                                        src.models.length > 0 ? src.models[0] : src.configured_model
                                      );
                                    }
                                  }}
                                  className="flex-1 bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
                                >
                                  {networkSourcesLoading ? (
                                    <option>Loading...</option>
                                  ) : networkSources.length === 0 ? (
                                    <option>No network sources found</option>
                                  ) : (
                                    networkSources.map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.label} ({s.host}:{s.port})
                                      </option>
                                    ))
                                  )}
                                </select>
                              </div>
                              {networkSourceId && (() => {
                                const src = networkSources.find((s) => s.id === networkSourceId);
                                if (!src) return null;
                                return (
                                  <div className="space-y-1.5">
                                    <select
                                      value={networkModelName}
                                      onChange={async (e) => {
                                        const val = e.target.value;
                                        setNetworkModelName(val);
                                        setNetModelSaved(false);
                                        try {
                                          await apiPost(`/api/config/model`, { provider: "worker", model: val });
                                          setNetModelSaved(true);
                                          setTimeout(() => setNetModelSaved(false), 2000);
                                        } catch { /* ignore */ }
                                      }}
                                      className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
                                    >
                                      {src.models.length > 0 ? (
                                        src.models.map((m) => (
                                          <option key={m} value={m}>{m}</option>
                                        ))
                                      ) : (
                                        <option value={src.configured_model}>{src.configured_model} (configured)</option>
                                      )}
                                    </select>
                                    {netModelSaved && (
                                      <div className="text-[10px] text-jade-glow flex items-center gap-1">
                                        <Check className="w-3 h-3" />
                                        Switched to {networkModelName}
                                      </div>
                                    )}
                                    <div className="text-[10px] text-zinc-600">
                                      {src.models.length > 0
                                        ? `${src.models.length} model${src.models.length !== 1 ? "s" : ""} discovered on ${src.label}`
                                        : src.error
                                          ? `Model discovery failed: ${src.error}`
                                          : `Using configured model`}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                      <label className="text-[10px] text-zinc-500">Protocol</label>
                                      <select
                                        value={config?.services?.worker_llm?.protocol || "ollama"}
                                        onChange={async (e) => {
                                          const val = e.target.value as "ollama" | "openai";
                                          setConfig((prev) => prev ? {
                                            ...prev,
                                            services: {
                                              ...prev.services,
                                              worker_llm: { ...prev.services.worker_llm, protocol: val },
                                            },
                                          } : prev);
                                          try {
                                            await apiPost(`/api/config/services`, {
                                              services: {
                                                worker_llm: { ...(config?.services?.worker_llm || {}), protocol: val },
                                              },
                                            });
                                          } catch { /* ignore */ }
                                        }}
                                        className="bg-black/40 border border-white/[0.08] rounded px-2 py-0.5 text-[10px] text-zinc-300 focus:outline-none"
                                      >
                                        <option value="ollama">Ollama</option>
                                        <option value="openai">OpenAI-compatible</option>
                                      </select>
                                    </div>
                                  </div>
                                );
                              })()}
                            </>
                          ) : (
                            <div className="text-[10px] text-zinc-500">Click to select a remote inference source</div>
                          )}
                        </div>
                      </label>
                    </div>
                    <button
                      onClick={async () => {
                        setSaving(true);
                        try {
                          const payload: Record<string, string> = { provider: modelProvider };
                          if (modelProvider === "worker" && networkModelName) {
                            payload.model = networkModelName;
                          }
                          await apiPost(`/api/config/model`, payload);
                          await fetchModelProvider();
                          setConfig((prev) => {
                            if (!prev) return prev;
                            return {
                              ...prev,
                              model_provider: {
                                provider: modelProvider,
                                model: modelProvider === "worker" ? networkModelName : currentModel,
                              },
                            };
                          });
                          setSaved(true);
                          setTimeout(() => setSaved(false), 2000);
                        } catch {
                          // silently fail
                        } finally {
                          setSaving(false);
                        }
                      }}
                      disabled={saving}
                      className="mt-4 px-4 py-1.5 text-sm bg-teal-mystic/20 text-teal-mystic border border-teal-mystic/30 rounded-lg hover:bg-teal-mystic/30 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {saving ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : saved ? (
                        <span className="text-jade-glow flex items-center gap-1.5">
                          <Check className="w-4 h-4" />
                          {modelProvider === "worker" ? networkModelName : currentModel}
                        </span>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Switch Provider
                        </>
                      )}
                    </button>
                  </div>

                  {/* Analysis Model */}
                  <div className="glass-panel !rounded-xl p-4">
                    <div className="text-xs font-semibold text-teal-mystic uppercase tracking-wider mb-3">
                      Analysis Model
                    </div>
                    <p className="text-[11px] text-zinc-500 mb-4">
                      Model used for AI-powered analysis (relationships, insights). Can be a larger model than the inference provider.
                    </p>
                    <div className="space-y-2">
                      <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        analysisProvider === "local"
                          ? "border-teal-mystic/40 bg-teal-mystic/5"
                          : "border-white/[0.06] bg-black/20 hover:border-white/[0.12]"
                      }`}>
                        <input
                          type="radio"
                          name="analysisProvider"
                          value="local"
                          checked={analysisProvider === "local"}
                          onChange={() => setAnalysisProvider("local")}
                          className="accent-teal-mystic"
                        />
                        <div className="flex-1">
                          <div className="text-sm text-zinc-200 font-medium">Local (CPU)</div>
                          {analysisProvider === "local" && (
                            <select
                              value={analysisModel}
                              onChange={async (e) => {
                                setAnalysisModel(e.target.value);
                                setAnalysisModelSaved(false);
                                try {
                                  await apiPost(`/api/config/analysis-model`, { model: e.target.value, provider: "local" });
                                  setAnalysisModelSaved(true);
                                  setTimeout(() => setAnalysisModelSaved(false), 2000);
                                } catch { /* ignore */ }
                              }}
                              className="mt-2 w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
                            >
                              {modelsLoading ? (
                                <option>Loading...</option>
                              ) : availableModels.length === 0 ? (
                                <option>No models found</option>
                              ) : (
                                availableModels.map((m) => (
                                  <option key={m} value={m}>{m}</option>
                                ))
                              )}
                            </select>
                          )}
                          {analysisProvider !== "local" && (
                            <div className="text-[10px] text-zinc-500 mt-1">Click to select local analysis model</div>
                          )}
                        </div>
                      </label>
                      <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        analysisProvider === "worker"
                          ? "border-teal-mystic/40 bg-teal-mystic/5"
                          : "border-white/[0.06] bg-black/20 hover:border-white/[0.12]"
                      }`}>
                        <input
                          type="radio"
                          name="analysisProvider"
                          value="worker"
                          checked={analysisProvider === "worker"}
                          onChange={() => setAnalysisProvider("worker")}
                          className="accent-teal-mystic mt-1"
                        />
                        <div className="flex-1 space-y-2">
                          <div className="text-sm text-zinc-200 font-medium">Network Source</div>
                          {analysisProvider === "worker" ? (
                            <>
                              <div className="flex gap-2">
                                <select
                                  value={analysisNetworkSourceId}
                                  onChange={(e) => {
                                    const src = networkSources.find((s) => s.id === e.target.value);
                                    setAnalysisNetworkSourceId(e.target.value);
                                    if (src) {
                                      setAnalysisNetworkModelName(
                                        src.models.length > 0 ? src.models[0] : src.configured_model
                                      );
                                    }
                                  }}
                                  className="flex-1 bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
                                >
                                  {networkSourcesLoading ? (
                                    <option>Loading...</option>
                                  ) : networkSources.length === 0 ? (
                                    <option>No network sources found</option>
                                  ) : (
                                    networkSources.map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.label} ({s.host}:{s.port})
                                      </option>
                                    ))
                                  )}
                                </select>
                              </div>
                              {analysisNetworkSourceId && (() => {
                                const src = networkSources.find((s) => s.id === analysisNetworkSourceId);
                                if (!src) return null;
                                return (
                                  <div className="space-y-1.5">
                                    <select
                                      value={analysisNetworkModelName}
                                      onChange={async (e) => {
                                        const val = e.target.value;
                                        setAnalysisNetworkModelName(val);
                                        setAnalysisModel(val);
                                        setAnalysisModelSaved(false);
                                        try {
                                          await apiPost(`/api/config/analysis-model`, { model: val, provider: "worker" });
                                          setAnalysisModelSaved(true);
                                          setTimeout(() => setAnalysisModelSaved(false), 2000);
                                        } catch { /* ignore */ }
                                      }}
                                      className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
                                    >
                                      {src.models.length > 0 ? (
                                        src.models.map((m) => (
                                          <option key={m} value={m}>{m}</option>
                                        ))
                                      ) : (
                                        <option value={src.configured_model}>{src.configured_model} (configured)</option>
                                      )}
                                    </select>
                                    {analysisModelSaved && (
                                      <div className="text-[10px] text-jade-glow flex items-center gap-1">
                                        <Check className="w-3 h-3" />
                                        Analysis model set to {analysisModel}
                                      </div>
                                    )}
                                    <div className="text-[10px] text-zinc-600">
                                      {src.models.length > 0
                                        ? `${src.models.length} model${src.models.length !== 1 ? "s" : ""} discovered on ${src.label}`
                                        : src.error
                                          ? `Model discovery failed: ${src.error}`
                                          : `Using configured model`}
                                    </div>
                                  </div>
                                );
                              })()}
                            </>
                          ) : (
                            <div className="text-[10px] text-zinc-500">Click to select a remote analysis source</div>
                          )}
                        </div>
                      </label>
                  </div>

                  {/* Embedding Model */}
                  <div className="glass-panel !rounded-xl p-4">
                    <div className="text-xs font-semibold text-teal-mystic uppercase tracking-wider mb-3">
                      Embedding Model
                    </div>
                    <p className="text-[11px] text-zinc-500 mb-4">
                      Model used for DDC/LCC embedding similarity. Must support /api/embeddings.
                    </p>
                    <input
                      type="text"
                      value={config?.embeddings?.model || "all-minilm:22m"}
                      onChange={(e) => {
                        if (!config) return;
                        setConfig({
                          ...config,
                          embeddings: { ...config.embeddings, model: e.target.value },
                        });
                      }}
                      placeholder="all-minilm:22m"
                      className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors font-mono"
                    />
                    <label className="text-[10px] text-zinc-600 uppercase tracking-wider block mt-3 mb-1.5">
                      Embedding Service URL
                    </label>
                    <p className="text-[10px] text-zinc-600 mb-2">
                      Leave blank to use the same service as the orchestrator model. Set if using Docker Model Runner (which doesn't serve embeddings).
                    </p>
                    <input
                      type="text"
                      value={config?.embeddings?.url || ""}
                      onChange={(e) => {
                        if (!config) return;
                        setConfig({
                          ...config,
                          embeddings: { ...config.embeddings, url: e.target.value },
                        });
                      }}
                      placeholder="http://127.0.0.1:11434"
                      className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors font-mono"
                    />
                  </div>

                  {/* Classifier Model */}
                  <div className="glass-panel !rounded-xl p-4">
                    <div className="text-xs font-semibold text-teal-mystic uppercase tracking-wider mb-3">
                      Classifier Model
                    </div>
                    <p className="text-[11px] text-zinc-500 mb-4">
                      Small model used by the background synesthesia classifier agent.
                    </p>
                    <input
                      type="text"
                      value={config?.classifier?.model || "qwen2.5:1.5b"}
                      onChange={(e) => {
                        if (!config) return;
                        setConfig({
                          ...config,
                          classifier: { ...config.classifier, model: e.target.value },
                        });
                      }}
                      placeholder="qwen2.5:1.5b"
                      className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors font-mono"
                    />
                  </div>
                </div>
                </div>
              )}

              {!loading && tab === "delete" && (
                <div className="space-y-4">
                  {!deleteTabReady ? (
                    <div className="flex items-center justify-center py-12 text-zinc-500">
                      <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                      Loading traces...
                    </div>
                  ) : deleteResult ? (
                    <div className="flex flex-col items-center gap-4 py-8">
                      <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
                        <Check className="w-6 h-6 text-red-400" />
                      </div>
                      <p className="text-sm text-zinc-300">{deleteResult}</p>
                      <button
                        onClick={() => {
                          setDeleteTabReady(false);
                          setDeleteResult(null);
                          setDeleteConfirm(false);
                        }}
                        className="px-4 py-1.5 text-sm bg-white/[0.04] text-zinc-400 border border-white/[0.08] rounded-lg hover:text-zinc-300 transition-colors"
                      >
                        Reload
                      </button>
                    </div>
                  ) : deleteConfirm ? (
                    <div className="glass-panel !rounded-xl p-6 space-y-4">
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="w-6 h-6 text-red-400 shrink-0" />
                        <div>
                          <p className="text-sm text-red-300 font-medium">Are you certain?</p>
                          <p className="text-[11px] text-zinc-500 mt-0.5">
                            This will permanently delete {deletePreviewCount} trace{deletePreviewCount !== 1 ? "s" : ""}. This cannot be undone.
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setDeleteConfirm(false)}
                          className="px-4 py-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={async () => {
                            setDeleting(true);
                            try {
                              let ids: string[] = allTraceMeta.map((t) => t.id);
                              if (deleteCriteria === "model") ids = allTraceMeta.filter((t) => t.model_used === deleteModel).map((t) => t.id);
                              else if (deleteCriteria === "ddc") ids = allTraceMeta.filter((t) => t.ddc_prompt?.[0] === deleteDdc).map((t) => t.id);
                              const data = await apiPost<{ deleted?: number }>(`/api/traces/bulk-delete`, { ids });
                              setDeleteResult(`Deleted ${data.deleted} trace${data.deleted !== 1 ? "s" : ""}.`);
                            } catch {
                              setDeleteResult("Deletion failed — check the backend logs.");
                            } finally {
                              setDeleting(false);
                            }
                          }}
                          disabled={deleting}
                          className="px-4 py-1.5 text-sm bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {deleting ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                          {deleting ? "Deleting..." : `Delete ${deletePreviewCount} trace${deletePreviewCount !== 1 ? "s" : ""}`}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Criteria */}
                      <div className="glass-panel !rounded-xl p-4 space-y-3">
                        <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                          Criteria
                        </div>
                        <div className="space-y-2">
                          <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            deleteCriteria === "all"
                              ? "border-teal-mystic/40 bg-teal-mystic/5"
                              : "border-white/[0.06] bg-black/20 hover:border-white/[0.12]"
                          }`}>
                            <input
                              type="radio"
                              name="delete-criteria"
                              value="all"
                              checked={deleteCriteria === "all"}
                              onChange={() => setDeleteCriteria("all")}
                              className="accent-teal-mystic"
                            />
                            <div>
                              <div className="text-sm text-zinc-200 font-medium">All traces</div>
                              <div className="text-[10px] text-zinc-500">{allTraceMeta.length} trace{allTraceMeta.length !== 1 ? "s" : ""} total</div>
                            </div>
                          </label>
                          <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            deleteCriteria === "model"
                              ? "border-teal-mystic/40 bg-teal-mystic/5"
                              : "border-white/[0.06] bg-black/20 hover:border-white/[0.12]"
                          }`}>
                            <input
                              type="radio"
                              name="delete-criteria"
                              value="model"
                              checked={deleteCriteria === "model"}
                              onChange={() => setDeleteCriteria("model")}
                              className="accent-teal-mystic"
                            />
                            <div className="flex-1">
                              <div className="text-sm text-zinc-200 font-medium">By model</div>
                              {deleteCriteria === "model" && (
                                <select
                                  value={deleteModel}
                                  onChange={(e) => setDeleteModel(e.target.value)}
                                  className="mt-2 w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
                                >
                                  <option value="" disabled>Select a model</option>
                                  {delModels.map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </label>
                          <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            deleteCriteria === "ddc"
                              ? "border-teal-mystic/40 bg-teal-mystic/5"
                              : "border-white/[0.06] bg-black/20 hover:border-white/[0.12]"
                          }`}>
                            <input
                              type="radio"
                              name="delete-criteria"
                              value="ddc"
                              checked={deleteCriteria === "ddc"}
                              onChange={() => setDeleteCriteria("ddc")}
                              className="accent-teal-mystic"
                            />
                            <div className="flex-1">
                              <div className="text-sm text-zinc-200 font-medium">By DDC main class</div>
                              {deleteCriteria === "ddc" && (
                                <select
                                  value={deleteDdc}
                                  onChange={(e) => setDeleteDdc(e.target.value)}
                                  className="mt-2 w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
                                >
                                  {["0: General", "1: Philosophy", "2: Religion", "3: Social", "4: Language", "5: Science", "6: Technology", "7: Arts", "8: Literature", "9: History"].map((opt) => (
                                    <option key={opt[0]} value={opt[0]}>{opt}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </label>
                        </div>
                      </div>

                      {/* Preview */}
                      <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                        <span className="text-sm text-zinc-400">
                          {deletePreviewCount} trace{deletePreviewCount !== 1 ? "s" : ""} will be deleted
                        </span>
                        {deletePreviewCount > 0 && (
                          <button
                            onClick={() => setDeleteConfirm(true)}
                            className="px-4 py-1.5 text-sm bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors flex items-center gap-1.5"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {!loading && tab === "schema" && (
                <div className="space-y-3">
                  <div className="glass-panel !rounded-xl p-4">
                    <div className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">
                      Synesthesia Classification Schema
                    </div>
                    <p className="text-[11px] text-zinc-500 mb-3">
                      Edit the classification rules and examples below. Changes take effect on the next classification cycle — no restart required.
                    </p>
                    {schemaLoading ? (
                      <div className="flex items-center justify-center py-12 text-zinc-500">
                        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                        Loading schema...
                      </div>
                    ) : schemaError ? (
                      <div className="text-sm text-red-400 py-4">{schemaError}</div>
                    ) : (
                      <>
                        <textarea
                          value={schemaContent}
                          onChange={(e) => {
                            setSchemaContent(e.target.value);
                            setSchemaSaved(false);
                          }}
                          className="w-full h-[50vh] bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-amber-500/50 transition-colors resize-none scrollbar-thin"
                          spellCheck={false}
                        />
                        <div className="flex items-center gap-2 mt-3">
                          <button
                            onClick={async () => {
                              setSaving(true);
                              setSchemaSaved(false);
                              setSchemaError(null);
                              try {
                                await apiPut(`/api/schema`, { content: schemaContent });
                                setSchemaSaved(true);
                                setTimeout(() => setSchemaSaved(false), 2000);
                              } catch (e) {
                                setSchemaError(e instanceof Error ? e.message : "Save failed");
                              } finally {
                                setSaving(false);
                              }
                            }}
                            disabled={saving}
                            className="px-4 py-1.5 text-sm bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/30 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                          >
                            {saving ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Save className="w-4 h-4" />
                            )}
                            {saving ? "Saving..." : "Save Schema"}
                          </button>
                          {schemaSaved && (
                            <span className="text-[11px] text-jade-glow flex items-center gap-1">
                              <Check className="w-3.5 h-3.5" />
                              Saved
                            </span>
                          )}
                          {schemaError && (
                            <span className="text-[11px] text-red-400">{schemaError}</span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-white/[0.06] shrink-0">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-[11px] text-zinc-500 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={config?.mask_ips ?? false}
                    onChange={(e) => {
                      if (!config) return;
                      setConfig({ ...config, mask_ips: e.target.checked });
                    }}
                    className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-teal-mystic cursor-pointer"
                  />
                  Mask IPs for demos
                </label>
                <span className="text-[10px] text-zinc-600">
                  Changes apply immediately — no restart required.
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !config}
                  className="px-4 py-1.5 text-sm bg-teal-mystic/20 text-teal-mystic border border-teal-mystic/30 rounded-lg hover:bg-teal-mystic/30 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {saving ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : saved ? (
                    <span className="text-jade-glow">Saved!</span>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
