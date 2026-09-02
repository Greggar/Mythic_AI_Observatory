"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cpu, Server } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";

interface Provider {
  id: string;
  label: string;
  icon: string;
  reachable?: boolean;
}

const ICON_MAP: Record<string, typeof Cpu> = { cpu: Cpu, server: Server };

export default function ModelSwitcher() {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiGet<Provider[]>("/api/config/providers")
      .then(setProviders)
      .catch(() =>
        setProviders([
          { id: "local", label: "Local CPU", icon: "cpu" },
          { id: "worker", label: "Worker Node", icon: "server" },
        ]),
      );
  }, []);

  useEffect(() => {
    apiGet<{ provider: string }>("/api/config/model")
      .then((d) => setProvider(d.provider || "local"))
      .catch(() => setProvider("local"));
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = useCallback(async (id: string) => {
    if (id === provider) { setOpen(false); return; }
    setSaving(true);
    try {
      const data = await apiPost<{ provider: string }>("/api/config/model", {
        provider: id,
        model: "",
      });
      setProvider(data.provider);
    } catch {
      // silently fail
    }
    setSaving(false);
    setOpen(false);
  }, [provider]);

  const active = providers.find((p) => p.id === provider) ?? providers[0];
  const Icon = active ? ICON_MAP[active.icon] || Server : Cpu;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(!open)}
        disabled={saving}
        className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono rounded-full border transition-all ${
          open
            ? "border-teal-mystic/30 text-teal-mystic bg-white/[0.04]"
            : "border-white/[0.06] text-zinc-500 hover:text-zinc-300 hover:border-white/[0.12]"
        }`}
        title={`Model provider: ${active?.label || "..."}`}
      >
        <Icon size={10} className={provider ? "" : "animate-pulse"} style={{ color: "#34d399" }} />
        <span>{provider ? (provider === "local" ? "CPU" : "GPU") : "..."}</span>
        <ChevronDown size={8} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-44 bg-[rgba(10,25,35,0.96)] backdrop-blur-lg border border-white/[0.08] rounded-lg shadow-xl z-[200] overflow-hidden">
          {providers.map((p) => {
            const PIcon = ICON_MAP[p.icon] || Server;
            const isActive = p.id === provider;
            return (
              <button
                key={p.id}
                onClick={() => p.reachable !== false && handleSelect(p.id)}
                disabled={saving || p.reachable === false}
                className={`flex items-center gap-2 w-full px-3 py-2 text-[11px] font-mono transition-colors ${
                  isActive
                    ? "text-white bg-white/[0.06]"
                    : p.reachable === false
                      ? "text-zinc-700 cursor-not-allowed"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]"
                }`}
                title={p.reachable === false ? `${p.label} — service not reachable` : p.label}
              >
                <PIcon size={12} className={p.reachable === false ? "opacity-30" : ""} style={{ color: "#a78bfa" }} />
                <span className={`flex-1 text-left ${p.reachable === false ? "opacity-30" : ""}`}>{p.label}</span>
                {p.reachable === false && (
                  <span className="text-[8px] text-zinc-700 font-mono tracking-wider">OFFLINE</span>
                )}
                {isActive && <Check size={10} className="text-teal-mystic" />}
                {saving && p.id !== provider && (
                  <span className="w-2 h-2 rounded-full bg-zinc-600 animate-pulse" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
