"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronRight, Server, Wifi, Cpu, Plus, Trash2, Sparkles, Search, Loader2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

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

interface WorkerEntry {
  id: string;
  name: string;
  host: string;
  desc: string;
  protocol: "ollama" | "openai";
  services: string[];
}

interface Props {
  onComplete: () => void;
}

export default function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [primaryName, setPrimaryName] = useState("");
  const [ollamaHost, setOllamaHost] = useState("127.0.0.1");
  const [ollamaPort, setOllamaPort] = useState("11434");
  const [workers, setWorkers] = useState<WorkerEntry[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredMachine[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, [step]);

  const scanNetwork = useCallback(async () => {
    setScanning(true);
    setScanError("");
    try {
      const res = await fetch(`${API_BASE}/api/network/scan`, { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setScanError(data.error);
      }
      setDiscovered(data.machines || []);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }, []);

  const ollamaDiscoveries = discovered.filter((m) =>
    m.services.some((s) => s.type === "ollama" || s.type === "docker_model_runner" || s.type === "vllm")
  );
  const workerDiscoveries = discovered.filter((m) =>
    m.services.some((s) => s.type === "ollama" || s.type === "docker_model_runner" || s.type === "vllm" || s.type === "observatory")
  );

  const addWorkerFromDiscovery = (machine: DiscoveredMachine) => {
    const ollamaSvc = machine.services.find((s) => s.type === "ollama" || s.type === "docker_model_runner" || s.type === "vllm");
    const obsSvc = machine.services.find((s) => s.type === "observatory");
    const services: string[] = [];
    if (ollamaSvc) services.push("worker_llm");
    if (obsSvc) services.push("openclaw");

    setWorkers((prev) => [
      ...prev,
      {
        id: `worker-${Date.now()}`,
        name: machine.hostname || machine.ip,
        host: machine.ip,
        desc: ollamaSvc
          ? `Ollama${ollamaSvc.models?.length ? ` (${ollamaSvc.models.length} models)` : ""}`
          : "Observatory instance",
        protocol: ollamaSvc?.protocol || "ollama",
        services,
      },
    ]);
  };

  const addWorker = () => {
    setWorkers((prev) => [
      ...prev,
      { id: `worker-${Date.now()}`, name: "", host: "", desc: "", protocol: "ollama", services: ["worker_llm"] },
    ]);
  };

  const updateWorker = (id: string, field: string, value: string) => {
    setWorkers((prev) => prev.map((w) => (w.id === id ? { ...w, [field]: value } : w)));
  };

  const removeWorker = (id: string) => {
    setWorkers((prev) => prev.filter((w) => w.id !== id));
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/config/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primary_name: primaryName || "Primary Server",
          ollama_host: ollamaHost,
          ollama_port: parseInt(ollamaPort, 10) || 11434,
          workers: workers.map((w) => ({
            id: w.id,
            name: w.name,
            host: w.host,
            desc: w.desc,
            protocol: w.protocol,
            services: w.services,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Setup failed");
      }
      setDone(true);
      setTimeout(() => onComplete(), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }, [primaryName, ollamaHost, ollamaPort, workers, onComplete]);

  const steps = [
    // Step 0: Name your server
    <div key="0" className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-teal-mystic/15 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-teal-mystic" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">Welcome!</h2>
          <p className="text-sm text-zinc-400">Let&apos;s set up your Mythic AI Observatory.</p>
        </div>
      </div>
      <div>
        <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-1.5">What do you call this server?</label>
        <input
          ref={inputRef}
          type="text"
          value={primaryName}
          onChange={(e) => setPrimaryName(e.target.value)}
          placeholder="e.g. Primary Server, My Machine, Orion"
          className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-4 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
          onKeyDown={(e) => e.key === "Enter" && setStep(1)}
        />
        <p className="text-[10px] text-zinc-600 mt-1">This is the machine running the Observatory dashboard and API.</p>
      </div>
    </div>,

    // Step 1: Ollama
    <div key="1" className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-violet-500/15 flex items-center justify-center">
          <Cpu className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">Local AI Engine</h2>
          <p className="text-sm text-zinc-400">Where is your model runner? (Ollama or Docker Model Runner)</p>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_100px] gap-3">
        <div>
          <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-1.5">Host</label>
          <input
            ref={inputRef}
            type="text"
            value={ollamaHost}
            onChange={(e) => setOllamaHost(e.target.value)}
            placeholder="127.0.0.1"
            className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-4 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors font-mono"
            onKeyDown={(e) => e.key === "Enter" && setStep(2)}
          />
        </div>
        <div>
          <label className="text-xs text-zinc-500 uppercase tracking-wider block mb-1.5">Port</label>
          <input
            type="text"
            value={ollamaPort}
            onChange={(e) => setOllamaPort(e.target.value)}
            placeholder="11434"
            className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-4 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors font-mono"
            onKeyDown={(e) => e.key === "Enter" && setStep(2)}
          />
        </div>
      </div>
      <p className="text-[10px] text-zinc-600">Ollama can be on this machine (127.0.0.1) or another machine on your network.</p>
      {/* Discovered Ollama instances */}
      {ollamaDiscoveries.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Discovered on network</label>
          {ollamaDiscoveries.map((m) => {
            const svc = m.services.find((s) => s.type === "ollama" || s.type === "docker_model_runner" || s.type === "vllm")!;
            const isSelected = ollamaHost === m.ip;
            return (
              <button
                key={m.ip}
                onClick={() => { setOllamaHost(m.ip); setOllamaPort(String(svc.port)); }}
                className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors flex items-center justify-between ${
                  isSelected
                    ? "bg-violet-500/15 border-violet-500/30 text-violet-300"
                    : "bg-black/20 border-white/[0.06] text-zinc-400 hover:border-white/[0.12]"
                }`}
              >
                <span className="font-mono">{m.ip}{m.hostname ? ` (${m.hostname})` : ""}</span>
                <span className="text-[10px] text-zinc-600">{svc.models?.length || 0} models</span>
              </button>
            );
          })}
        </div>
      )}
      {/* Scan button */}
      {ollamaDiscoveries.length === 0 && !scanning && (
        <button
          onClick={scanNetwork}
          className="w-full py-2 border border-dashed border-white/[0.08] rounded-xl text-xs text-zinc-500 hover:text-violet-400 hover:border-violet-500/30 transition-colors flex items-center justify-center gap-1.5"
        >
          <Search className="w-3.5 h-3.5" />
          Scan network for Ollama
        </button>
      )}
      {scanning && (
        <div className="flex items-center justify-center gap-2 text-xs text-zinc-500 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Scanning subnet...
        </div>
      )}
      {scanError && <p className="text-[10px] text-red-400/80">{scanError}</p>}
    </div>,

    // Step 2: Workers (optional)
    <div key="2" className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center">
          <Server className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">Worker Machines</h2>
          <p className="text-sm text-zinc-400">Any remote AI nodes on your network? (optional)</p>
        </div>
      </div>
      {/* Discovered machines */}
      {workerDiscoveries.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Discovered on network</label>
          {workerDiscoveries.map((m) => {
            const alreadyAdded = workers.some((w) => w.host === m.ip);
            const svc = m.services.find((s) => s.type === "ollama" || s.type === "docker_model_runner" || s.type === "vllm");
            return (
              <button
                key={m.ip}
                onClick={() => !alreadyAdded && addWorkerFromDiscovery(m)}
                disabled={alreadyAdded}
                className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors flex items-center justify-between ${
                  alreadyAdded
                    ? "bg-teal-mystic/10 border-teal-mystic/20 text-teal-mystic/60"
                    : "bg-black/20 border-white/[0.06] text-zinc-400 hover:border-amber-500/30 hover:text-amber-300"
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
      <div className="space-y-2">
        {workers.map((w) => (
          <div key={w.id} className="glass-panel !rounded-xl p-3 space-y-2 relative">
            <button
              onClick={() => removeWorker(w.id)}
              className="absolute top-2 right-2 text-zinc-600 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-zinc-500 uppercase tracking-wider block mb-0.5">Name</label>
                <input
                  type="text"
                  value={w.name}
                  onChange={(e) => updateWorker(w.id, "name", e.target.value)}
                  placeholder="Worker 1"
                  className="w-full bg-black/40 border border-white/[0.08] rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
                />
              </div>
              <div>
                <label className="text-[9px] text-zinc-500 uppercase tracking-wider block mb-0.5">Host</label>
                <input
                  type="text"
                  value={w.host}
                  onChange={(e) => updateWorker(w.id, "host", e.target.value)}
                  placeholder="192.0.2.1"
                  className="w-full bg-black/40 border border-white/[0.08] rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors font-mono"
                />
              </div>
            </div>
            <div>
              <label className="text-[9px] text-zinc-500 uppercase tracking-wider block mb-0.5">Description</label>
              <input
                type="text"
                value={w.desc}
                onChange={(e) => updateWorker(w.id, "desc", e.target.value)}
                placeholder="GPU inference node"
                className="w-full bg-black/40 border border-white/[0.08] rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-teal-mystic/50 transition-colors"
              />
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          {workerDiscoveries.length === 0 && !scanning && (
            <button
              onClick={scanNetwork}
              className="flex-1 py-2 border border-dashed border-white/[0.08] rounded-xl text-xs text-zinc-500 hover:text-amber-400 hover:border-amber-500/30 transition-colors flex items-center justify-center gap-1.5"
            >
              <Search className="w-3.5 h-3.5" />
              Scan network
            </button>
          )}
          <button
            onClick={addWorker}
            className={`${workerDiscoveries.length === 0 ? "flex-1" : "w-full"} py-2 border border-dashed border-white/[0.08] rounded-xl text-xs text-zinc-500 hover:text-teal-mystic hover:border-teal-mystic/30 transition-colors flex items-center justify-center gap-1.5`}
          >
            <Plus className="w-3.5 h-3.5" />
            Add manually
          </button>
        </div>
        {scanning && (
          <div className="flex items-center justify-center gap-2 text-xs text-zinc-500 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Scanning subnet...
          </div>
        )}
      </div>
    </div>,

    // Step 3: Review
    <div key="3" className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-teal-mystic/15 flex items-center justify-center">
          <Check className="w-5 h-5 text-teal-mystic" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">Ready to go</h2>
          <p className="text-sm text-zinc-400">Review your setup before saving.</p>
        </div>
      </div>
      <div className="glass-panel !rounded-xl p-4 space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-teal-mystic/60" />
          <span className="text-zinc-300">{primaryName || "Primary Server"}</span>
          <span className="text-zinc-600 text-xs">(this machine)</span>
        </div>
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-violet-400/60" />
          <span className="text-zinc-300">Ollama</span>
          <span className="text-zinc-500 font-mono text-xs">{ollamaHost}:{ollamaPort}</span>
        </div>
        {workers.map((w, i) => (
          <div key={w.id} className="flex items-center gap-2">
            <Server className="w-4 h-4 text-amber-400/60" />
            <span className="text-zinc-300">{w.name || `Worker ${i + 1}`}</span>
            <span className="text-zinc-500 font-mono text-xs">{w.host}</span>
            {w.desc && <span className="text-zinc-600 text-xs">— {w.desc}</span>}
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        onClick={handleSave}
        disabled={saving || done}
        className="w-full py-2.5 rounded-lg bg-teal-mystic/20 text-teal-mystic border border-teal-mystic/30 hover:bg-teal-mystic/30 transition-colors text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {done ? (
          <>
            <Check className="w-4 h-4" />
            Done!
          </>
        ) : saving ? (
          <span className="w-4 h-4 border-2 border-teal-mystic/30 border-t-teal-mystic rounded-full animate-spin" />
        ) : (
          <>
            Save & Start
            <ChevronRight className="w-4 h-4" />
          </>
        )}
      </button>
    </div>,
  ];

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="w-full max-w-lg mx-4"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Step indicator */}
          <div className="flex items-center gap-1.5 mb-4 px-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-1.5 flex-1">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold transition-colors ${
                    i === step
                      ? "bg-teal-mystic/20 text-teal-mystic border border-teal-mystic/30"
                      : i < step
                        ? "bg-teal-mystic/10 text-teal-mystic/60"
                        : "bg-white/[0.04] text-zinc-600"
                  }`}
                >
                  {i < step ? <Check className="w-3 h-3" /> : i + 1}
                </div>
                {i < 3 && <div className={`flex-1 h-px ${i < step ? "bg-teal-mystic/20" : "bg-white/[0.06]"}`} />}
              </div>
            ))}
          </div>

          {/* Step content */}
          <div className="glass-panel p-6 min-h-[280px] flex flex-col justify-between">
            {steps[step]}

            {/* Navigation buttons */}
            {step < 3 && (
              <div className="flex justify-between mt-6 pt-4 border-t border-white/[0.04]">
                <button
                  onClick={() => setStep((p) => Math.max(0, p - 1))}
                  disabled={step === 0}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-30 px-3 py-1.5"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep((p) => Math.min(3, p + 1))}
                  className="text-xs px-4 py-1.5 rounded-lg bg-teal-mystic/15 text-teal-mystic border border-teal-mystic/20 hover:bg-teal-mystic/25 transition-colors flex items-center gap-1"
                >
                  Next
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
