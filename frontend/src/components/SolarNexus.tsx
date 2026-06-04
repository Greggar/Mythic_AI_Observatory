"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import type { Telemetry } from "@/hooks/useWebSocket";
import type { TraceSession, TraceStep } from "@/types/trace";

interface Props {
  telemetry: Telemetry | null;
  trace: TraceSession | null;
  traceActive: boolean;
  activeTraceStep: number | null;
  phase?: "idle" | "replaying" | "complete";
  observatoryMode?: boolean;
}

const SIZE = 800;
const CX = SIZE / 2;
const CY = SIZE / 2;
const RING_R = 240;

const STEP_LABELS = [
  "Request Received",
  "Intent Classification",
  "Agent Selection",
  "Memory Retrieval",
  "Context Synthesis",
  "Response Generation",
  "Final Response",
];

const AGENT_NAMES: Record<string, string> = {
  "step-2": "Intent Classifier",
  "step-3": "Agent Selector",
  "step-4": "Memory Retriever",
  "step-5": "Context Synthesizer",
  "step-6": "Response Generator",
};

const SYSTEM_PROMPTS: Record<string, string | null> = {
  "step-2": "You are an intent classifier. Respond with one short sentence classifying the user request.",
  "step-5": "You are a synthesizer. In one sentence, note the key context for responding to this request.",
  "step-6": "You are a wise and knowledgeable AI oracle. Provide a thoughtful, clear response to the user.",
};

const CTX_WINDOW = 4096;

function estimateTokens(text: string): number {
  return Math.round(text.length / 4);
}

function pos(deg: number, r: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

const ANGLES = [0, 1, 2, 3, 4, 5, 6].map((i) => i * 51.4 - 90);

function formatTime(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function stepStatus(
  index: number,
  activeStepIndex: number | null,
  phase: "idle" | "replaying" | "complete"
): "pending" | "active" | "complete" {
  if (phase === "complete") return "complete";
  if (activeStepIndex === null) return "pending";
  if (index < activeStepIndex) return "complete";
  if (index === activeStepIndex) return "active";
  return "pending";
}

const STATUS_COLORS = {
  pending: { stroke: "oklch(58% 0.10 75 / 0.12)", fill: "oklch(58% 0.10 75 / 0.04)", text: "oklch(52% 0.03 265 / 0.4)", pulse: [0.3, 0.6] },
  active: { stroke: "#fbbf24", fill: "rgba(251,191,36,0.06)", text: "#fbbf24", pulse: [0.5, 1] },
  complete: { stroke: "#34d399", fill: "rgba(52,211,153,0.06)", text: "#34d399", pulse: [0.3, 0.6] },
};

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
  telemetry,
  trace,
  traceActive,
  activeTraceStep,
  phase = "idle",
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [timeOffset, setTimeOffset] = useState(0);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const interval = setInterval(() => setTimeOffset((p) => (p + 0.15) % 360), 1000);
    return () => clearInterval(interval);
  }, [mounted]);

  const handleNodeClick = useCallback((i: number) => {
    setSelectedStep((prev) => (prev === i ? null : i));
  }, []);

  const totalDuration = trace?.steps.reduce((a, s) => a + (s.duration_ms || 0), 0) ?? 0;
  const conductorState = !telemetry?.cpu ? "offline"
    : telemetry.cpu.percent > 80 ? "busy"
    : telemetry.cpu.percent > 50 ? "processing"
    : "online";

  const driftAngle = timeOffset;

  if (phase === "idle" && !trace && !traceActive) {
    return (
      <div className="glass-panel p-5 flex flex-col items-center overflow-hidden">
        <div className="flex flex-col items-center gap-1.5 mb-3 z-10">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            className="text-[oklch(72%_0.11_75)]">
            <circle cx="12" cy="12" r="5" />
            <circle cx="12" cy="12" r="9" opacity="0.4" strokeDasharray="2 3" />
            <circle cx="12" cy="12" r="11" opacity="0.2" strokeDasharray="1 4" />
          </svg>
          <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
            Agent Nexus
          </span>
        </div>

        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="relative w-full max-w-[600px] h-auto" style={{ zIndex: 1 }}>
          <circle cx={CX} cy={CY} r={RING_R} fill="none" stroke="oklch(58% 0.10 75 / 0.08)" strokeWidth="0.5" strokeDasharray="2 6" />

          {[0, 72, 144, 216, 288].map((base, i) => {
            const a = base + driftAngle;
            const p = pos(a, RING_R);
            return (
              <motion.circle
                key={`drift-${i}`}
                cx={p.x} cy={p.y} r={2.5}
                fill="oklch(58% 0.10 75 / 0.15)"
                animate={mounted ? { opacity: [0.1, 0.3, 0.1] } : {}}
                transition={{ duration: 3 + i * 0.5, repeat: Infinity, ease: "easeInOut" }}
              />
            );
          })}

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
    <div className="glass-panel p-5 flex flex-col items-center overflow-hidden">
      <div className="flex flex-col items-center gap-1.5 mb-3 z-10">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
          className="text-[oklch(72%_0.11_75)]">
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="9" opacity="0.4" strokeDasharray="2 3" />
          <circle cx="12" cy="12" r="11" opacity="0.2" strokeDasharray="1 4" />
        </svg>
        <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
          Agent Nexus
        </span>
      </div>

      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="relative w-full max-w-[600px] h-auto" style={{ zIndex: 1 }}>
        <circle cx={CX} cy={CY} r={RING_R} fill="none" stroke="oklch(58% 0.10 75 / 0.08)" strokeWidth="0.5" strokeDasharray="2 6" />

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

        {ANGLES.map((angle, i) => {
          const p = pos(angle, RING_R);
          const status = stepStatus(i, activeTraceStep, phase);
          const s = STATUS_COLORS[status];
          const step = trace?.steps[i];
          const duration = step?.duration_ms ?? null;
          const label = STEP_LABELS[i];
          const agent = step?.agent_used;
          const isActive = status === "active";
          const nodeR = isActive ? 18 : 14;
          const isSelected = selectedStep === i;

          return (
            <g key={`stage-${i}`}>
              <circle cx={p.x} cy={p.y} r={nodeR} fill={s.fill} stroke={isSelected ? "#2dd4bf" : s.stroke} strokeWidth={isSelected ? 2.5 : (isActive ? 2 : 1)} />
              <motion.circle
                cx={p.x} cy={p.y} r={isActive ? 6 : 4}
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
              {agent && (
                <text x={p.x} y={p.y + nodeR + 27} textAnchor="middle"
                  fill="oklch(52% 0.03 265 / 0.4)" fontSize="9" fontFamily="monospace">
                  {agent}
                </text>
              )}
              {duration !== null && status !== "pending" && (
                <text x={p.x} y={p.y + nodeR + 38} textAnchor="middle"
                  fill="oklch(52% 0.03 265 / 0.35)" fontSize="8" fontFamily="monospace">
                  {formatTime(duration)}
                </text>
              )}
              <circle
                cx={p.x} cy={p.y} r={nodeR + 6}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={() => handleNodeClick(i)}
              />
            </g>
          );
        })}

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
                {AGENT_NAMES[`step-${selectedStep + 1}`] || ""}
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
              {trace?.model_used && (
                <text x={CX} y={CY - 6} textAnchor="middle"
                  fill="oklch(52% 0.03 265 / 0.5)" fontSize="6.5" fontFamily="monospace">
                  {trace.model_used}
                </text>
              )}
              <text x={CX} y={CY + 10} textAnchor="middle"
                fill="oklch(72% 0.11 75)" fontSize="16" fontFamily="monospace" fontWeight="bold">
                {phase === "complete" ? formatTime(totalDuration) : "…"}
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
                  {selectedTraceStep.agent_used && (
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {selectedTraceStep.agent_used}
                    </span>
                  )}
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
    </div>
  );
}
