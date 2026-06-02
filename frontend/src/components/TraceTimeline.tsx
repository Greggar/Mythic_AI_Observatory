"use client";

import { motion } from "framer-motion";
import { Activity } from "lucide-react";
import TimelineStep from "./TimelineStep";
import type { TraceSession } from "@/types/trace";

interface Props {
  trace: TraceSession;
}

export default function TraceTimeline({ trace }: Props) {
  return (
    <div className="glass-panel p-5 space-y-4">
      <div className="flex flex-col items-center gap-1.5 text-teal-mystic">
        <Activity size={16} />
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
            Orchestration Trace
          </span>
          <span className="text-[10px] font-mono text-zinc-600">
            {trace.id}
          </span>
        </div>
      </div>

      {/* prompt */}
      <div className="px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
        <p className="text-xs text-zinc-400 font-mono leading-relaxed">
          {trace.prompt}
        </p>
      </div>

      {/* timeline */}
      <div className="pl-1">
        {trace.steps.map((step, i) => (
          <TimelineStep
            key={step.id}
            step={step}
            index={i}
            isLast={i === trace.steps.length - 1}
          />
        ))}
      </div>

      {/* output */}
      {trace.output && (
        <motion.div
          className="px-4 py-3 rounded-xl bg-teal-mystic/[0.04] border border-teal-mystic/[0.08]"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <div className="text-[10px] font-semibold tracking-widest uppercase text-teal-mystic/60 mb-2">
            Resolution
          </div>
          <pre className="text-xs text-zinc-300 font-mono leading-relaxed whitespace-pre-wrap">
            {trace.output}
          </pre>
        </motion.div>
      )}
    </div>
  );
}
