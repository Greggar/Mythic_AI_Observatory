"use client";

import { motion } from "framer-motion";
import type { Telemetry } from "@/hooks/useWebSocket";
import type { TraceSession } from "@/types/trace";

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

export default function SolarNexus({
  telemetry,
  trace,
  traceActive,
  activeTraceStep,
  phase = "idle",
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [timeOffset, setTimeOffset] = useState(0);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const interval = setInterval(() => setTimeOffset((p) => (p + 0.15) % 360), 1000);
    return () => clearInterval(interval);
  }, [mounted]);

  const totalDuration = trace?.steps.reduce((a, s) => a + (s.duration_ms || 0), 0) ?? 0;
  const conductorState = !telemetry ? "offline"
    : telemetry.cpu.percent > 80 ? "busy"
    : telemetry.cpu.percent > 50 ? "processing"
    : "online";

  // Build ring orbit angle with a slow steady drift
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
          {/* Orbital ring */}
          <circle cx={CX} cy={CY} r={RING_R} fill="none" stroke="oklch(58% 0.10 75 / 0.08)" strokeWidth="0.5" strokeDasharray="2 6" />

          {/* Drifting orbital dots */}
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

          {/* Core */}
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
        {/* Outer orbital ring */}
        <circle cx={CX} cy={CY} r={RING_R} fill="none" stroke="oklch(58% 0.10 75 / 0.08)" strokeWidth="0.5" strokeDasharray="2 6" />

        {/* Connection arcs between consecutive completed stages */}
        {trace && ANGLES.map((_, i) => {
          if (i >= 6) return null;
          const status = stepStatus(i, activeTraceStep, phase);
          const nextStatus = stepStatus(i + 1, activeTraceStep, phase);
          if (status !== "complete" || nextStatus === "pending") return null;
          const a = pos(ANGLES[i], RING_R);
          const b = pos(ANGLES[i + 1], RING_R);
          return (
            <motion.path
              key={`arc-${i}`}
              d={`M ${a.x} ${a.y} Q ${CX} ${CY} ${b.x} ${b.y}`}
              fill="none" stroke="rgba(52,211,153,0.25)" strokeWidth="2.5"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            />
          );
        })}

        {/* Pipeline stage nodes around the ring */}
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

          return (
            <g key={`stage-${i}`}>
              {/* Node */}
              <circle cx={p.x} cy={p.y} r={nodeR} fill={s.fill} stroke={s.stroke} strokeWidth={isActive ? 2 : 1} />
              {/* Inner glow */}
              <motion.circle
                cx={p.x} cy={p.y} r={isActive ? 6 : 4}
                fill={s.stroke}
                animate={mounted ? { opacity: s.pulse } : {}}
                transition={{ duration: isActive ? 1.5 : 3, repeat: Infinity, ease: "easeInOut" }}
              />
              {/* Stage number */}
              <text x={p.x} y={p.y + 2} textAnchor="middle" fill={s.text}
                fontSize="10" fontFamily="monospace" fontWeight="bold">
                {i + 1}
              </text>
              {/* Label below node */}
              <text x={p.x} y={p.y + nodeR + 14} textAnchor="middle" fill={s.text}
                fontSize="10" fontFamily="monospace" letterSpacing="0.04em">
                {label}
              </text>
              {/* Agent name */}
              {agent && (
                <text x={p.x} y={p.y + nodeR + 27} textAnchor="middle"
                  fill="oklch(52% 0.03 265 / 0.4)" fontSize="9" fontFamily="monospace">
                  {agent}
                </text>
              )}
              {/* Duration */}
              {duration !== null && status !== "pending" && (
                <text x={p.x} y={p.y + nodeR + 38} textAnchor="middle"
                  fill="oklch(52% 0.03 265 / 0.35)" fontSize="8" fontFamily="monospace">
                  {formatTime(duration)}
                </text>
              )}
            </g>
          );
        })}

        {/* Centre core — summary */}
        <g>
          {/* Core ring */}
          <circle cx={CX} cy={CY} r={55} fill="oklch(14% 0.04 268)" stroke="oklch(58% 0.10 75 / 0.1)" strokeWidth="0.5" />
          <motion.circle
            cx={CX} cy={CY} r={55}
            fill="none" stroke="oklch(58% 0.10 75 / 0.06)"
            animate={mounted ? { r: [55, 62, 55], opacity: [0.06, 0.12, 0.06] } : {}}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Status */}
          <text x={CX} y={CY - 20} textAnchor="middle"
            fill="oklch(72% 0.11 75 / 0.6)" fontSize="7" fontFamily="monospace" letterSpacing="0.1em">
            {phase === "complete" ? "COMPLETE" : "PROCESSING"}
          </text>

          {/* Model */}
          {trace?.model_used && (
            <text x={CX} y={CY - 6} textAnchor="middle"
              fill="oklch(52% 0.03 265 / 0.5)" fontSize="6.5" fontFamily="monospace">
              {trace.model_used}
            </text>
          )}

          {/* Elapsed time */}
          <text x={CX} y={CY + 10} textAnchor="middle"
            fill="oklch(72% 0.11 75)" fontSize="16" fontFamily="monospace" fontWeight="bold">
            {phase === "complete" ? formatTime(totalDuration) : "…"}
          </text>

          {/* Step count */}
          <text x={CX} y={CY + 26} textAnchor="middle"
            fill="oklch(52% 0.03 265 / 0.4)" fontSize="6.5" fontFamily="monospace">
            {activeTraceStep !== null ? `${activeTraceStep + 1} / ${ANGLES.length} stages` : `${ANGLES.length} stages`}
          </text>

          {/* Confidence when complete */}
          {phase === "complete" && trace?.confidence !== null && trace && (
            <text x={CX} y={CY + 38} textAnchor="middle"
              fill="oklch(72% 0.11 75 / 0.5)" fontSize="7" fontFamily="monospace">
              Confidence {Math.round(trace.confidence * 100)}%
            </text>
          )}

          {/* Model-based state indicator */}
          {trace && phase !== "complete" && (
            <motion.circle
              cx={CX + 50} cy={CY - 30} r={3}
              fill="#fbbf24"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </g>
      </svg>
    </div>
  );
}

import { useEffect, useState } from "react";
