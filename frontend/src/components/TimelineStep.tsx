"use client";

import { motion } from "framer-motion";
import { CheckCircle, Circle, Clock, Loader } from "lucide-react";
import { useState } from "react";
import type { TraceStep } from "@/types/trace";

interface Props {
  step: TraceStep;
  index: number;
  isLast: boolean;
}

const STATUS_MAP = {
  pending: { icon: Circle, color: "#1e293b", pulse: false },
  processing: { icon: Loader, color: "#fbbf24", pulse: true },
  complete: { icon: CheckCircle, color: "#34d399", pulse: false },
  error: { icon: Circle, color: "#ef4444", pulse: true },
};

export default function TimelineStep({ step, index, isLast }: Props) {
  const config = STATUS_MAP[step.status] || STATUS_MAP.pending;
  const Icon = config.icon;
  const [showContext, setShowContext] = useState(false);

  return (
    <motion.div
      className="relative flex gap-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.15, ease: "easeOut" }}
    >
      {/* connection line */}
      {!isLast && (
        <div className="absolute left-[11px] top-6 bottom-0 w-px bg-white/[0.06]" />
      )}

      {/* status icon */}
      <div className="relative z-10 mt-0.5">
        {config.pulse ? (
          <motion.div
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <Icon size={22} style={{ color: config.color }} />
          </motion.div>
        ) : (
          <Icon size={22} style={{ color: config.color }} />
        )}
      </div>

      {/* content */}
      <div className="flex-1 min-w-0 pb-6">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-zinc-200">{step.label}</span>
          <span className="text-[10px] font-mono text-zinc-600">
            {step.status}
          </span>
        </div>

        <div className="flex items-center gap-3 mt-0.5">
          {step.duration_ms !== null && (
            <span className="flex items-center gap-1 text-[11px] font-mono text-zinc-500">
              <Clock size={10} />
              {step.duration_ms}ms
            </span>
          )}
        </div>

        {(step.metadata?.output as string | undefined) && (
          <div className="mt-1 text-[10px] text-zinc-500 font-mono leading-relaxed line-clamp-1">
            {(step.metadata.output as string)}
          </div>
        )}

        {step.context_assembled && (
          <div className="mt-1.5">
            <button
              onClick={() => setShowContext(!showContext)}
              className="text-[9px] font-mono tracking-wider text-teal-mystic/50 hover:text-teal-mystic/80 transition-colors"
            >
              {showContext ? "▾ Hide assembled context" : "▸ Show assembled context"}
            </button>
            {showContext && (
              <pre className="mt-1 text-[9px] text-zinc-600 font-mono leading-relaxed max-h-24 overflow-y-auto whitespace-pre-wrap
                bg-white/[0.03] rounded p-1.5">
                {step.context_assembled}
              </pre>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
