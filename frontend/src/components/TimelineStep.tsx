"use client";

import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle, Circle, Clock, Loader } from "lucide-react";
import EntropyTrajectoryChart from "./EntropyTrajectoryChart";
import type { TraceStep, TokenEntropy } from "@/types/trace";

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
  "Intent Classification": "Embedding-based classifier assigns one of 13 intent categories via all-minilm cosine similarity — no LLM call, completes in ~73ms.",
  "Model Routing": "Maps the classified intent to the available execution model. Currently routes to the default handler since only one model backend is available.",
  "Memory Retrieval": "Vector similarity search over past trace embeddings. Top-5 relevant chunks are tagged as used or discarded based on a relevance threshold.",
  "Context Assembly": "Retrieved chunks and user input are assembled into the context window. The LLM assembly step was removed for efficiency — primary intent is echoed as synthesised instruction.",
  "Response Generation": "The selected model generates a response using the assembled context. Streams tokens in real-time.",
  "Output Packaging": "Output is stored on the trace. Heuristic insights (stage bottlenecks, cold start, service health) are computed from recorded metrics.",
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
          {Boolean(step.metadata?.stale) && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-amber-400/80">
              <AlertTriangle size={10} />
              stuck ({String(step.metadata?.stale_seconds)}s)
            </span>
          )}
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

        {/* Token entropy — uncertainty trajectory over the generation */}
        {step.label === "Response Generation" && (
          (() => {
            const ent = step.metadata?.token_entropy as TokenEntropy | undefined;
            if (!ent) return null;
            return (
              <div className="mt-2 rounded-lg bg-violet-500/[0.04] border border-violet-500/[0.08] px-2.5 py-2">
                <div className="text-[9px] font-semibold tracking-widest uppercase text-violet-400/70 mb-1">
                  Token Uncertainty Trajectory
                </div>
                <EntropyTrajectoryChart entropy={ent} output={step.metadata?.output as string | undefined} />
              </div>
            );
          })()
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
