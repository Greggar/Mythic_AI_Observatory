"use client";

import { GitBranch, Globe, Zap } from "lucide-react";
import type { Telemetry } from "@/hooks/useWebSocket";

interface Props {
  telemetry: Telemetry | null;
}

const pathways = [
  { icon: Globe, label: "Ollama Models", value: "ollama.count", fallback: "—" },
  { icon: GitBranch, label: "Remotes", value: "remotes.online", fallback: "0" },
  { icon: Zap, label: "Gateway", value: "openclaw.status", fallback: "—" },
];

export default function DecisionPathways({ telemetry }: Props) {
  const ollamaCount = telemetry?.ollama.count ?? null;
  const remotesOnline = telemetry?.remotes.filter((r) => r.status === "ok").length ?? 0;
  const gwStatus = telemetry?.openclaw.status ?? "—";

  const values = [String(ollamaCount ?? "—"), String(remotesOnline), gwStatus];

  return (
    <div className="glass-panel p-5 space-y-5">
      <div className="flex items-center gap-2 text-solar-gold">
        <GitBranch size={16} />
        <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">Decision Pathways</span>
      </div>

      <div className="space-y-3">
        {pathways.map((p, i) => {
          const Icon = p.icon;
          return (
            <div key={p.label} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03]">
              <Icon size={16} className="text-zinc-500" />
              <span className="text-xs text-zinc-400 flex-1">{p.label}</span>
              <span className="text-sm font-mono text-zinc-200">{values[i]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
