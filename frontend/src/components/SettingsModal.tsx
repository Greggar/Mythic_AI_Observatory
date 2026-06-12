"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Save, Server, Wifi, Cpu, RefreshCw, Plus, Trash2, Check } from "lucide-react";

interface ServiceConfig {
  label: string;
  host: string;
  port: number;
  model?: string;
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
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

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
  const [tab, setTab] = useState<"services" | "machines" | "models">("services");
  const [modelProvider, setModelProvider] = useState<string>("local");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState<string>("phi4-mini");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelSaved, setModelSaved] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/network-config`);
      const data = await res.json();
      setConfig(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchModelProvider = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/config/model`);
      const data = await res.json();
      setModelProvider(data.provider || "local");
    } catch {
      // silently fail
    }
  }, []);

  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const [listRes, currentRes] = await Promise.all([
        fetch(`${API_BASE}/api/models`),
        fetch(`${API_BASE}/api/models/current`),
      ]);
      const list = await listRes.json();
      const cur = await currentRes.json();
      if (list.models) setAvailableModels(list.models);
      if (cur.model) setCurrentModel(cur.model);
    } catch {
      // silently fail
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchConfig();
      fetchModelProvider();
      fetchModels();
      setSaved(false);
      setModelSaved(false);
    }
  }, [open, fetchConfig, fetchModelProvider, fetchModels]);

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

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/network-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => onClose(), 1200);
      }
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
                    <div key={id} className="glass-panel !rounded-xl p-4 space-y-2">
                      <div className="text-xs font-semibold text-teal-mystic uppercase tracking-wider mb-2">
                        {svc.label}
                      </div>
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
                  <button
                    onClick={addMachine}
                    className="w-full py-2.5 border border-dashed border-white/[0.08] rounded-xl text-sm text-zinc-500 hover:text-teal-mystic hover:border-teal-mystic/30 transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Machine
                  </button>
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
                        <div>
                          <div className="text-sm text-zinc-200 font-medium">Local (CPU)</div>
                          <div className="text-[10px] text-zinc-500">{currentModel} on Gingerlong — slow but self-contained</div>
                        </div>
                      </label>
                      <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        modelProvider === "backoffice"
                          ? "border-teal-mystic/40 bg-teal-mystic/5"
                          : "border-white/[0.06] bg-black/20 hover:border-white/[0.12]"
                      }`}>
                        <input
                          type="radio"
                          name="provider"
                          value="backoffice"
                          checked={modelProvider === "backoffice"}
                          onChange={() => setModelProvider("backoffice")}
                          className="accent-teal-mystic"
                        />
                        <div>
                          <div className="text-sm text-zinc-200 font-medium">BackOffice (GPU)</div>
                          <div className="text-[10px] text-zinc-500">qwen3.5:9B on BackOffice PC — fast, requires LAN connection</div>
                        </div>
                      </label>
                    </div>
                    <button
                      onClick={async () => {
                        setSaving(true);
                        try {
                          const res = await fetch(`${API_BASE}/api/config/model`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ provider: modelProvider }),
                          });
                          if (res.ok) {
                            setSaved(true);
                            setTimeout(() => setSaved(false), 2000);
                          }
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
                        <span className="text-jade-glow">Saved!</span>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Switch Provider
                        </>
                      )}
                    </button>
                  </div>

                  {/* Model Selector (local only) */}
                  <div className="glass-panel !rounded-xl p-4">
                    <div className="text-xs font-semibold text-teal-mystic uppercase tracking-wider mb-3">
                      Local Model
                    </div>
                    <p className="text-[11px] text-zinc-500 mb-3">
                      Select which model Ollama runs locally. Changes take effect on the next trace.
                    </p>
                    {modelsLoading ? (
                      <div className="flex items-center gap-2 text-zinc-500 text-sm py-2">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Loading models...
                      </div>
                    ) : availableModels.length === 0 ? (
                      <div className="text-zinc-600 text-xs py-2">
                        No models found. Make sure Ollama is running.
                      </div>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-thin">
                        {availableModels.map((m) => (
                          <button
                            key={m}
                            onClick={async () => {
                              setCurrentModel(m);
                              setModelSaved(false);
                              try {
                                const res = await fetch(`${API_BASE}/api/models/select`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ model: m }),
                                });
                                if (res.ok) {
                                  setModelSaved(true);
                                  setTimeout(() => setModelSaved(false), 2000);
                                }
                              } catch {
                                // silently fail
                              }
                            }}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                              currentModel === m
                                ? "bg-teal-mystic/10 text-teal-mystic border border-teal-mystic/20"
                                : "text-zinc-400 hover:bg-white/[0.03] border border-transparent"
                            }`}
                          >
                            <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                              currentModel === m
                                ? "border-teal-mystic bg-teal-mystic/20"
                                : "border-zinc-600"
                            }`}>
                              {currentModel === m && <Check className="w-2 h-2 text-teal-mystic" />}
                            </div>
                            <span className="font-mono text-xs">{m}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {modelSaved && (
                      <div className="mt-3 text-[11px] text-jade-glow flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Switched to {currentModel}
                      </div>
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
