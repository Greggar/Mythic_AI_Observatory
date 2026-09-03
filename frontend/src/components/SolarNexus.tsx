"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import type { TraceSession, TraceStep } from "@/types/trace";

interface Props {
  trace: TraceSession | null;
  traceActive: boolean;
  activeTraceStep: number | null;
  phase?: "idle" | "replaying" | "complete";
}

const SIZE = 800;
const CX = SIZE / 2;
const CY = SIZE / 2;
const RING_R = 240;

const STEP_LABELS = [
  "Request Received",
  "Intent Classification",
  "Model Routing",
  "Memory Retrieval",
  "Context Assembly",
  "Response Generation",
  "Output Packaging",
];

const STAGE_DESCRIPTIONS: { role: string; detail: string }[] = [
  {
    role: "Prompt ingestion.",
    detail:
      "Handles the raw API boundary. It captures the user\u2019s input, logs the initial timestamp, sanitizes the data, and prepares the payload for the internal pipeline.",
  },
  {
    role: "Intent classification.",
    detail:
      "An embedding-based classifier (all-minilm:22m cosine similarity) determines what the user actually wants — factual query, creative writing, enumeration, constraint testing, or one of 13 intent categories. No LLM call needed: the entire step completes in ~73ms.",
  },
  {
    role: "Model routing.",
    detail:
      "Maps the classified intent to the execution model. Since only a single model backend is available, this step selects the default handler and passes intent metadata forward for context assembly.",
  },
  {
    role: "Memory retrieval.",
    detail:
      "Vector similarity search over past trace embeddings (all-minilm:22m cosine similarity). The top-5 most relevant historical chunks are retrieved and tagged as used or discarded based on a relevance threshold, providing context for the response.",
  },
  {
    role: "Context assembly.",
    detail:
      "Assembles the retrieved memory chunks and user input into a single context window for the generation model. Currently echoes the primary intent as a synthesised instruction — the full LLM-based assembly step was removed for efficiency, reducing trace time by 13\u201374s.",
  },
  {
    role: "Response generation.",
    detail:
      "This is where the core model finally executes. Because all the routing, memory gathering, and context filtering were done in steps 2\u20135, this model can focus purely on generating a high-quality, precise token stream.",
  },
  {
    role: "Output packaging.",
    detail:
      "The final output is stored on the trace session. Heuristic insights (slowest stage, cold start detection, service health) are computed from the recorded metrics and attached to the trace for the dashboard.",
  },
];

const SYSTEM_PROMPTS: Record<string, string | null> = {
  "step-2": null,
  "step-5": null,
  "step-6": "You are a wise and knowledgeable AI oracle. Provide a thoughtful, clear response to the user.",
};

const CTX_WINDOW = 4096;

const STAGE_WEIGHTS: number[] = [0.3, 0.6, 0.2, 0.6, 0.4, 1.0, 0.2];

type StageType = "model" | "embedding" | "noop";
const STAGE_TYPES: StageType[] = ["noop", "embedding", "noop", "embedding", "noop", "model", "noop"];

const BASE_WEIGHT_R = 20;

type StageStatus = "pending" | "active" | "complete";
function stageColor(type: StageType, status: StageStatus) {
  const colors: Record<StageType, Record<StageStatus, { stroke: string; fill: string; text: string; pulse: [number, number] }>> = {
    model: {
      pending: { stroke: "oklch(58% 0.10 75 / 0.15)", fill: "oklch(58% 0.10 75 / 0.04)", text: "oklch(52% 0.03 265 / 0.3)", pulse: [0.15, 0.3] },
      active: { stroke: "#fbbf24", fill: "rgba(251,191,36,0.1)", text: "#fbbf24", pulse: [0.5, 1] },
      complete: { stroke: "#fbbf24", fill: "rgba(251,191,36,0.04)", text: "#fbbf2480", pulse: [0.15, 0.4] },
    },
    embedding: {
      pending: { stroke: "oklch(58% 0.10 75 / 0.12)", fill: "oklch(58% 0.10 75 / 0.04)", text: "oklch(52% 0.03 265 / 0.3)", pulse: [0.1, 0.25] },
      active: { stroke: "#2dd4bf", fill: "rgba(45,212,191,0.08)", text: "#2dd4bf", pulse: [0.3, 0.7] },
      complete: { stroke: "#2dd4bf", fill: "rgba(45,212,191,0.04)", text: "#2dd4bf80", pulse: [0.1, 0.3] },
    },
    noop: {
      pending: { stroke: "oklch(52% 0.03 265 / 0.3)", fill: "oklch(52% 0.03 265 / 0.04)", text: "oklch(52% 0.03 265 / 0.4)", pulse: [0.1, 0.25] },
      active: { stroke: "oklch(72% 0.11 75 / 0.5)", fill: "oklch(72% 0.11 75 / 0.06)", text: "oklch(72% 0.11 75 / 0.7)", pulse: [0.2, 0.4] },
      complete: { stroke: "oklch(52% 0.03 265 / 0.3)", fill: "oklch(52% 0.03 265 / 0.04)", text: "oklch(52% 0.03 265 / 0.5)", pulse: [0.1, 0.25] },
    },
  };
  return colors[type][status];
}

function estimateTokens(text: string): number {
  return Math.round(text.length / 4);
}

function pos(deg: number, r: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

const ANGLES = [0, 1, 2, 3, 4, 5, 6].map((i) => i * 51.4 - 90);

function formatTime(ms: number | null): string {
  if (ms === null || ms === undefined) return "\u2014";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function stepStatus(
  index: number,
  activeStepIndex: number | null,
  phase: "idle" | "replaying" | "complete"
): StageStatus {
  if (phase === "complete") return "complete";
  if (activeStepIndex === null) return "pending";
  if (index < activeStepIndex) return "complete";
  if (index === activeStepIndex) return "active";
  return "pending";
}

function TokenMeter({ text }: { text: string }) {
  const tokens = estimateTokens(text);
  const pct = Math.min((tokens / CTX_WINDOW) * 100, 100);
  const color = pct > 85 ? "#ef4444" : pct > 60 ? "#fbbf24" : "#34d399";
  return (
    <div className="mt-3">
      <div className="flex justify-between text-[10px] font-mono mb-1">
        <span className="text-zinc-500">Token budget</span>
        <span className="text-zinc-400">{tokens.toLocaleString()} / {CTX_WINDOW.toLocaleString()}</span>
      </div>
      <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(pct, 100)}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

function ContextPane({ step, systemPrompt }: { step: TraceStep; systemPrompt: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-3 text-xs font-mono">
      <div className="bg-black/40 rounded-lg p-3 border border-white/[0.04]">
        <div className="text-[10px] text-teal-mystic/60 uppercase tracking-wider mb-2">System Prompt</div>
        <div className="text-zinc-400 whitespace-pre-wrap break-words max-h-32 overflow-y-auto scrollbar-thin">
          {systemPrompt || "(no system prompt for this stage)"}
        </div>
      </div>
      <div className="bg-black/40 rounded-lg p-3 border border-white/[0.04]">
        <div className="text-[10px] text-teal-mystic/60 uppercase tracking-wider mb-2">Assembled Context</div>
        <div className="text-zinc-400 whitespace-pre-wrap break-words max-h-32 overflow-y-auto scrollbar-thin">
          {step.context_assembled || "(no context assembled)"}
        </div>
      </div>
    </div>
  );
}

export default function SolarNexus({
  trace,
  traceActive,
  activeTraceStep,
  phase = "idle",
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [hoveredStage, setHoveredStage] = useState<{ index: number; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const handleNodeClick = useCallback((i: number) => {
    setSelectedStep((prev) => (prev === i ? null : i));
  }, []);

  const totalDuration = trace?.steps.reduce((a, s) => a + (s.duration_ms || 0), 0) ?? 0;
  const modelName = trace?.model_used || "qwen2.5:3b";

  // Model element positioned at top-center above the ring
  const MODEL_CX = CX;
  const MODEL_CY = 70;
  const MODEL_R = 35;

  // Step 6 position (response generation — the only stage that calls the LLM)
  const s6 = pos(ANGLES[5], RING_R);

  if (phase === "idle" && !trace && !traceActive) {
    return (
      <div className="glass-panel p-5 flex flex-col items-center overflow-hidden" ref={containerRef}>
        <div className="flex flex-col items-center gap-1.5 mb-3 z-10">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            className="text-[oklch(72%_0.11_75)]">
            <circle cx="12" cy="12" r="5" />
            <circle cx="12" cy="12" r="9" opacity="0.4" strokeDasharray="2 3" />
            <circle cx="12" cy="12" r="11" opacity="0.2" strokeDasharray="1 4" />
          </svg>
          <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
            Stage Orbit
          </span>
        </div>

        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="relative w-full max-w-[600px] h-auto" style={{ zIndex: 1 }}>
          <circle cx={CX} cy={CY} r={RING_R} fill="none" stroke="oklch(58% 0.10 75 / 0.08)" strokeWidth="0.5" strokeDasharray="2 6" />

          <circle cx={CX} cy={CY} r={30} fill="oklch(14% 0.04 268)" stroke="oklch(58% 0.10 75 / 0.15)" strokeWidth="0.5" />
          <motion.circle
            cx={CX} cy={CY} r={12}
            fill="oklch(58% 0.10 75 / 0.08)"
            animate={mounted ? { r: [12, 16, 12], opacity: [0.08, 0.15, 0.08] } : {}}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />
          <text x={CX} y={CY + 4} textAnchor="middle" fill="oklch(72% 0.11 75 / 0.5)"
            fontSize="9" fontFamily="monospace" letterSpacing="0.12em">
            STANDBY
          </text>
        </svg>
      </div>
    );
  }

  const selectedTraceStep = selectedStep !== null ? trace?.steps[selectedStep] ?? null : null;
  const selectedSystemPrompt = selectedStep !== null ? SYSTEM_PROMPTS[`step-${selectedStep + 1}`] ?? null : null;

  return (
    <div className="glass-panel p-5 flex flex-col items-center overflow-hidden" ref={containerRef}>
      <div className="flex flex-col items-center gap-1.5 mb-3 z-10">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
          className="text-[oklch(72%_0.11_75)]">
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="9" opacity="0.4" strokeDasharray="2 3" />
          <circle cx="12" cy="12" r="11" opacity="0.2" strokeDasharray="1 4" />
        </svg>
        <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
          Stage Orbit
        </span>
      </div>

      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="relative w-full max-w-[600px] h-auto" style={{ zIndex: 1 }}>
        <circle cx={CX} cy={CY} r={RING_R} fill="none" stroke="oklch(58% 0.10 75 / 0.08)" strokeWidth="0.5" strokeDasharray="2 6" />

        {/* Sequential stage-to-stage arcs */}
        {trace && ANGLES.map((_, i) => {
          if (i >= 6) return null;
          const status = stepStatus(i, activeTraceStep, phase);
          const nextStatus = stepStatus(i + 1, activeTraceStep, phase);
          if (status === "pending" || nextStatus === "pending") return null;
          const a = pos(ANGLES[i], RING_R);
          const b = pos(ANGLES[i + 1], RING_R);
          const isActiveArc = status === "active" || nextStatus === "active";
          const arcColor = isActiveArc ? "rgba(251,191,36,0.4)" : "rgba(52,211,153,0.25)";
          return (
            <g key={`arc-${i}`}>
              <motion.path
                d={`M ${a.x} ${a.y} Q ${CX} ${CY} ${b.x} ${b.y}`}
                fill="none" stroke={arcColor} strokeWidth={isActiveArc ? 3 : 2.5}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
              />
              {isActiveArc && mounted && (
                <motion.circle
                  r={3}
                  fill="#fbbf24"
                  initial={{ offsetDistance: "0%" }}
                  animate={{ offsetDistance: "100%" }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                  style={{
                    offsetPath: `path('M ${a.x} ${a.y} Q ${CX} ${CY} ${b.x} ${b.y}')`,
                  }}
                />
              )}
            </g>
          );
        })}

        {/* Step-6 to Model connection — the only actual LLM call */}
        {trace && (stepStatus(5, activeTraceStep, phase) !== "pending") && (
          <g key="model-link">
            <motion.path
              d={`M ${s6.x} ${s6.y} Q 250 200 ${MODEL_CX} ${MODEL_CY}`}
              fill="none"
              stroke="rgba(251,191,36,0.35)"
              strokeWidth={2}
              strokeDasharray="4 6"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.3 }}
            />
            {stepStatus(5, activeTraceStep, phase) === "active" && mounted && (
              <motion.circle
                r={2.5}
                fill="#fbbf24"
                initial={{ offsetDistance: "0%" }}
                animate={{ offsetDistance: "100%" }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  offsetPath: `path('M ${s6.x} ${s6.y} Q 250 200 ${MODEL_CX} ${MODEL_CY}')`,
                }}
              />
            )}
          </g>
        )}

        {/* Stage nodes */}
        {ANGLES.map((angle, i) => {
          const p = pos(angle, RING_R);
          const status = stepStatus(i, activeTraceStep, phase);
          const type = STAGE_TYPES[i];
          const s = stageColor(type, status);
          const step = trace?.steps[i];
          const duration = step?.duration_ms ?? null;
          const label = STEP_LABELS[i];
          const isActive = status === "active";
          const weight = STAGE_WEIGHTS[i];
          const nodeR = Math.max(4, BASE_WEIGHT_R * weight * (isActive ? 1.2 : 1));
          const innerR = Math.max(2, 6 * weight * (isActive ? 1.3 : 1));
          const isSelected = selectedStep === i;

          return (
            <g key={`stage-${i}`}>
              <circle cx={p.x} cy={p.y} r={nodeR} fill={s.fill} stroke={isSelected ? "#2dd4bf" : s.stroke} strokeWidth={isSelected ? 2.5 : (isActive ? 2 : 1)} />
              <motion.circle
                cx={p.x} cy={p.y} r={innerR}
                fill={s.stroke}
                animate={mounted ? { opacity: s.pulse } : {}}
                transition={{ duration: isActive ? 1.5 : 3, repeat: Infinity, ease: "easeInOut" }}
              />
              <text x={p.x} y={p.y + 2} textAnchor="middle" fill={s.text}
                fontSize="10" fontFamily="monospace" fontWeight="bold">
                {i + 1}
              </text>
              <text x={p.x} y={p.y + nodeR + 14} textAnchor="middle" fill={s.text}
                fontSize="10" fontFamily="monospace" letterSpacing="0.04em">
                {label}
              </text>
              {duration !== null && status !== "pending" && (
                <text x={p.x} y={p.y + nodeR + 27} textAnchor="middle"
                  fill="oklch(52% 0.03 265 / 0.35)" fontSize="8" fontFamily="monospace">
                  {formatTime(duration)}
                </text>
              )}
              <circle
                cx={p.x} cy={p.y} r={nodeR + 6}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={() => handleNodeClick(i)}
                onMouseEnter={(e) => setHoveredStage({ index: i, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setHoveredStage({ index: i, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHoveredStage(null)}
              />
            </g>
          );
        })}

        {/* External Model element — positioned above the ring */}
        <g>
          <circle cx={MODEL_CX} cy={MODEL_CY} r={MODEL_R} fill="oklch(14% 0.04 268)" stroke="rgba(251,191,36,0.2)" strokeWidth="0.5" />
          <motion.circle
            cx={MODEL_CX} cy={MODEL_CY} r={MODEL_R}
            fill="none" stroke="rgba(251,191,36,0.15)"
            animate={mounted ? { r: [MODEL_R, MODEL_R + 8, MODEL_R], opacity: [0.15, 0.3, 0.15] } : {}}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.circle
            cx={MODEL_CX} cy={MODEL_CY} r={MODEL_R - 5}
            fill="rgba(251,191,36,0.06)"
            animate={mounted ? { r: [MODEL_R - 5, MODEL_R + 4, MODEL_R - 5], opacity: [0.06, 0.15, 0.06] } : {}}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
          />
          <text x={MODEL_CX} y={MODEL_CY - 14} textAnchor="middle"
            fill="rgba(251,191,36,0.5)" fontSize="6.5" fontFamily="monospace" letterSpacing="0.12em">
            INFERENCE
          </text>
          <text x={MODEL_CX} y={MODEL_CY + 4} textAnchor="middle"
            fill="#fbbf24" fontSize="9" fontFamily="monospace" fontWeight="bold">
            {modelName}
          </text>
          {phase === "complete" && (
            <text x={MODEL_CX} y={MODEL_CY + 18} textAnchor="middle"
              fill="rgba(52,211,153,0.5)" fontSize="7" fontFamily="monospace">
              ● READY
            </text>
          )}
          {trace && phase !== "complete" && phase !== "idle" && (
            <motion.circle
              cx={MODEL_CX} cy={MODEL_CY} r={MODEL_R + 6}
              fill="none" stroke="rgba(251,191,36,0.3)" strokeWidth="1.5"
              animate={{ r: [MODEL_R + 6, MODEL_R + 18, MODEL_R + 6], opacity: [0.3, 0, 0.3] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
            />
          )}
        </g>

        {/* Central status display */}
        <g>
          <circle cx={CX} cy={CY} r={55} fill="oklch(14% 0.04 268)" stroke="oklch(58% 0.10 75 / 0.1)" strokeWidth="0.5" />
          <motion.circle
            cx={CX} cy={CY} r={55}
            fill="none" stroke="oklch(58% 0.10 75 / 0.06)"
            animate={mounted ? { r: [55, 62, 55], opacity: [0.06, 0.12, 0.06] } : {}}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />

          {selectedStep !== null ? (
            <>
              <text x={CX} y={CY - 20} textAnchor="middle"
                fill="#2dd4bf" fontSize="8" fontFamily="monospace" letterSpacing="0.08em">
                {STEP_LABELS[selectedStep]}
              </text>
              <text x={CX} y={CY - 6} textAnchor="middle"
                fill="oklch(52% 0.03 265 / 0.5)" fontSize="6.5" fontFamily="monospace">
                Stage {selectedStep + 1}
              </text>
              <text x={CX} y={CY + 12} textAnchor="middle"
                fill="oklch(72% 0.11 75 / 0.4)" fontSize="7" fontFamily="monospace">
                Clicked — context below
              </text>
              <text
                x={CX + 48} y={CY - 30}
                fill="oklch(52% 0.03 265 / 0.3)"
                fontSize="14" fontFamily="monospace"
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedStep(null)}
              >✕</text>
            </>
          ) : (
            <>
              <text x={CX} y={CY - 20} textAnchor="middle"
                fill="oklch(72% 0.11 75 / 0.6)" fontSize="7" fontFamily="monospace" letterSpacing="0.1em">
                {phase === "complete" ? "COMPLETE" : "PROCESSING"}
              </text>
              <text x={CX} y={CY + 10} textAnchor="middle"
                fill="oklch(72% 0.11 75)" fontSize="16" fontFamily="monospace" fontWeight="bold">
                {phase === "complete" ? formatTime(totalDuration) : "\u2026"}
              </text>
              <text x={CX} y={CY + 26} textAnchor="middle"
                fill="oklch(52% 0.03 265 / 0.4)" fontSize="6.5" fontFamily="monospace">
                {activeTraceStep !== null ? `${activeTraceStep + 1} / ${ANGLES.length} stages` : `${ANGLES.length} stages`}
              </text>
              {phase === "complete" && trace?.confidence !== null && trace && (
                <text x={CX} y={CY + 38} textAnchor="middle"
                  fill="oklch(72% 0.11 75 / 0.5)" fontSize="7" fontFamily="monospace">
                  Confidence {Math.round(trace.confidence * 100)}%
                </text>
              )}
              {trace && phase !== "complete" && (
                <>
                  <motion.circle
                    cx={CX} cy={CY} r={35}
                    fill="#fbbf24"
                    animate={{ r: [35, 50, 35], opacity: [0.04, 0.1, 0.04] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <motion.circle
                    cx={CX + 50} cy={CY - 30} r={3}
                    fill="#fbbf24"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                  />
                </>
              )}
            </>
          )}
        </g>
      </svg>

      <AnimatePresence>
        {selectedTraceStep && (
          <motion.div
            className="w-full mt-4"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <div className="glass-panel !rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-teal-mystic uppercase tracking-wider">
                    {selectedTraceStep.label}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedStep(null)}
                  className="text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ContextPane step={selectedTraceStep} systemPrompt={selectedSystemPrompt} />
              {selectedTraceStep.context_assembled && (
                <TokenMeter text={selectedTraceStep.context_assembled} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {hoveredStage !== null && createPortal(
        <div
          className="fixed z-[100] pointer-events-none"
          style={{ left: hoveredStage.x + 16, top: hoveredStage.y - 10 }}
        >
          <div className="bg-[#0f0f14] border border-white/10 rounded-xl p-3.5 shadow-2xl max-w-[320px]">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />
              <span className="text-[11px] font-semibold text-teal-mystic uppercase tracking-wider">
                {STEP_LABELS[hoveredStage.index]}
              </span>
            </div>
            <div className="text-[11px] font-mono text-zinc-400 leading-relaxed mb-2">
              {STAGE_DESCRIPTIONS[hoveredStage.index].role}
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              {STAGE_DESCRIPTIONS[hoveredStage.index].detail}
            </p>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
