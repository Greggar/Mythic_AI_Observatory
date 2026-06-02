"use client";

import { motion } from "framer-motion";
import {
  Search,
  Clock,
  Cpu,
  Brain,
  Network,
  HardDrive,
  Zap,
  User,
} from "lucide-react";
import type { TraceSession } from "@/types/trace";

interface Props {
  trace: TraceSession | null;
}

function formatDuration(ms: number): string {
  if (ms > 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  return `${min}m ago`;
}

export default function SessionInspector({ trace }: Props) {
  if (!trace) {
    return (
      <div className="glass-panel p-5 space-y-4">
        <div className="flex flex-col items-center gap-1.5 text-zinc-500">
          <Search size={16} />
          <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
            Session Inspector
          </span>
        </div>
        <div className="text-[10px] text-zinc-600 font-mono text-center py-4">
          Select a trace to inspect
        </div>
      </div>
    );
  }

  const totalDuration = trace.steps.reduce((acc, s) => acc + (s.duration_ms || 0), 0);
  const impact = trace.telemetry_impact;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel p-5 space-y-4"
    >
      <div className="flex flex-col items-center gap-1.5 text-teal-mystic">
        <Search size={16} />
        <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
          Session Inspector
        </span>
      </div>

      {/* Prompt */}
      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
        <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider mb-1">Prompt</div>
        <div className="text-[11px] text-zinc-300 font-mono leading-relaxed line-clamp-3">
          {trace.prompt}
        </div>
      </div>

      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 rounded-xl bg-white/[0.03]">
          <div className="flex items-center gap-1.5 mb-1">
            <Clock size={10} className="text-zinc-500" />
            <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider">Start</span>
          </div>
          <div className="text-[10px] font-mono text-zinc-300">{timeAgo(trace.created_at)}</div>
        </div>

        <div className="p-2.5 rounded-xl bg-white/[0.03]">
          <div className="flex items-center gap-1.5 mb-1">
            <Clock size={10} className="text-zinc-500" />
            <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider">Duration</span>
          </div>
          <div className="text-[10px] font-mono text-zinc-300">{formatDuration(totalDuration)}</div>
        </div>

        <div className="p-2.5 rounded-xl bg-white/[0.03]">
          <div className="flex items-center gap-1.5 mb-1">
            <Brain size={10} className="text-zinc-500" />
            <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider">Model</span>
          </div>
          <div className="text-[10px] font-mono text-zinc-300 truncate" title={trace.model_used || "—"}>
            {trace.model_used || "—"}
          </div>
        </div>

        <div className="p-2.5 rounded-xl bg-white/[0.03]">
          <div className="flex items-center gap-1.5 mb-1">
            <User size={10} className="text-zinc-500" />
            <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider">Agent</span>
          </div>
          <div className="text-[10px] font-mono text-zinc-300 truncate" title={trace.agent_used || "—"}>
            {trace.agent_used || "—"}
          </div>
        </div>
      </div>

      {/* Telemetry impact */}
      {impact && (
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
          <div className="flex items-center gap-1.5 mb-2">
            <Zap size={10} className="text-solar-gold" />
            <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider">
              Telemetry Impact
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[9px] font-mono text-zinc-600">Peak CPU</div>
              <div className="text-xs font-mono text-zinc-300">{impact.peak_cpu}%</div>
            </div>
            <div>
              <div className="text-[9px] font-mono text-zinc-600">Peak RAM</div>
              <div className="text-xs font-mono text-zinc-300">{impact.peak_mem}%</div>
            </div>
            <div>
              <div className="text-[9px] font-mono text-zinc-600">Avg CPU</div>
              <div className="text-xs font-mono text-zinc-300">{impact.avg_cpu}%</div>
            </div>
            <div>
              <div className="text-[9px] font-mono text-zinc-600">Avg RAM</div>
              <div className="text-xs font-mono text-zinc-300">{impact.avg_mem}%</div>
            </div>
          </div>
        </div>
      )}

      {/* Step timeline mini */}
      <div className="space-y-1">
        <div className="text-[8px] font-mono text-zinc-600 uppercase tracking-wider mb-1.5">Stages</div>
        {trace.steps.map((step, i) => (
          <div key={step.id} className="flex items-center gap-2 py-1">
            <div
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                step.status === "complete"
                  ? "bg-jade-glow"
                  : step.status === "error"
                    ? "bg-red-500"
                    : "bg-zinc-600"
              }`}
            />
            <span className="text-[9px] font-mono text-zinc-400 flex-1 truncate">{step.label}</span>
            {step.duration_ms && (
              <span className="text-[8px] font-mono text-zinc-600">{formatDuration(step.duration_ms)}</span>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
}
