"use client";

import { Activity, Cpu, HardDrive, Monitor } from "lucide-react";
import { motion } from "framer-motion";
import type { Telemetry } from "@/hooks/useWebSocket";

interface Props {
  telemetry: Telemetry | null;
  connected: boolean;
}

function GaugeBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-mono">
        <span className="text-zinc-400">{label}</span>
        <span style={{ color }}>{value.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

export default function SystemVitals({ telemetry, connected }: Props) {
  const cpu = telemetry?.cpu.percent ?? 0;
  const mem = telemetry?.memory.percent ?? 0;
  const gpuUtil = telemetry?.gpu.gpu_util ?? 0;
  const gpuMem = telemetry?.gpu.gpu_mem_pct ?? 0;

  return (
    <div className="glass-panel p-5 space-y-5">
      <div className="flex items-center gap-2 text-teal-mystic">
        <Activity size={16} />
        <span className="text-xs font-semibold tracking-widest uppercase">System Vitals</span>
        <span
          className={`ml-auto w-2 h-2 rounded-full ${connected ? "bg-jade-glow" : "bg-red-500"}`}
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3 text-zinc-300">
          <Cpu size={14} className="text-solar-gold" />
          <div className="flex-1 space-y-2">
            <GaugeBar label="CPU" value={cpu} color="#fbbf24" />
            <GaugeBar label="Memory" value={mem} color="#fbbf24" />
          </div>
        </div>

        <div className="flex items-center gap-3 text-zinc-300">
          <Monitor size={14} className="text-teal-mystic" />
          <div className="flex-1 space-y-2">
            <GaugeBar label="GPU Util" value={gpuUtil} color="#2dd4bf" />
            <GaugeBar label="GPU Mem" value={gpuMem} color="#2dd4bf" />
          </div>
        </div>
      </div>

      <div className="pt-2 border-t border-white/5">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <HardDrive size={12} />
          <span className="font-mono">{telemetry?.hostname ?? "…"}</span>
        </div>
      </div>
    </div>
  );
}
