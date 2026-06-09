"use client";

import { motion } from "framer-motion";
import { CheckCircle, Circle, Clock, Loader } from "lucide-react";
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

const STAGE_DESCRIPTIONS: Record<string, string> = {
  "Request Received": "Raw prompt enters the system. Parsed and normalized before routing to the orchestration pipeline.",
  "Intent Classification": "Prompt is analysed to determine user goal, domain, and required capabilities. Routes to the correct agent or model.",
  "Agent Selection": "The most suitable agent or model is selected based on intent, resource availability, and capability requirements.",
  "Memory Retrieval": "Relevant context from past traces, annotations, and the vector store is retrieved to inform the current response.",
  "Context Synthesis": "Retrieved memory is merged with the system prompt and user input to form the complete context window for the model.",
  "Response Generation": "The selected model generates a response using the synthesised context. Streams tokens in real-time.",
  "Final Response": "Generated output is post-processed, formatted, and delivered. Insights and confidence are computed from the result.",
};

export default function TimelineStep({ step, index, isLast }: Props) {
  const config = STATUS_MAP[step.status] || STATUS_MAP.pending;
  const Icon = config.icon;
  const desc = STAGE_DESCRIPTIONS[step.label];

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

        {/* Stage description — narrative explanation */}
        {desc && (
          <div className="mt-1.5 text-[10px] text-zinc-500 italic leading-relaxed">
            {desc}
          </div>
        )}

        {/* Step output */}
        {(step.metadata?.output as string | undefined) && (
          <div className="mt-1.5 text-[10px] text-zinc-400 font-mono leading-relaxed">
            <span className="text-teal-mystic/70">[{step.label}]</span>{" "}
            <span>{(step.metadata.output as string)}</span>
          </div>
        )}

        {/* Assembled context chain — always visible */}
        {step.context_assembled && (
          <div className="mt-2 text-[10px] font-mono leading-relaxed whitespace-pre-wrap">
            {step.context_assembled.split("\n").map((line, i) => {
              const match = line.match(/^\[([^\]]+)\]:\s*(.*)/);
              if (match) {
                return (
                  <div key={i}>
                    <span className="text-teal-mystic/70">[{match[1]}]</span>
                    <span className="text-zinc-500">: {match[2]}</span>
                  </div>
                );
              }
              return (
                <div key={i} className="text-zinc-400">{line}</div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}
