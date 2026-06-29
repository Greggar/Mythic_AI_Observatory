"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cpu, Server } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

const PROVIDERS = [
  { id: "local",      label: "Local CPU",     icon: Cpu,    color: "#34d399" },
  { id: "backoffice", label: "Backoffice GPU", icon: Server, color: "#a78bfa" },
] as const;

export default function ModelSwitcher() {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch current config on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/config/model`)
      .then((r) => r.json())
      .then((d) => setProvider(d.provider || "local"))
      .catch(() => setProvider("local"));
  }, []);

  // Close on outside click
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
      const res = await fetch(`${API_BASE}/api/config/model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id, model: "" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProvider(data.provider);
    } catch {
      // silently fail
    }
    setSaving(false);
    setOpen(false);
  }, [provider]);

  const active = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];

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
        title={`Model provider: ${active.label}`}
      >
        <active.icon size={10} className={provider ? "" : "animate-pulse"} style={{ color: active.color }} />
        <span>{provider ? (provider === "local" ? "CPU" : "GPU") : "..."}</span>
        <ChevronDown size={8} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-44 bg-[rgba(10,25,35,0.96)] backdrop-blur-lg border border-white/[0.08] rounded-lg shadow-xl z-[200] overflow-hidden">
          {PROVIDERS.map((p) => {
            const Icon = p.icon;
            const isActive = p.id === provider;
            return (
              <button
                key={p.id}
                onClick={() => handleSelect(p.id)}
                disabled={saving}
                className={`flex items-center gap-2 w-full px-3 py-2 text-[11px] font-mono transition-colors ${
                  isActive
                    ? "text-white bg-white/[0.06]"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]"
                }`}
              >
                <Icon size={12} style={{ color: p.color }} />
                <span className="flex-1 text-left">{p.label}</span>
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
