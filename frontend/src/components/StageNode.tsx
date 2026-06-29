"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import type { Telemetry } from "@/hooks/useWebSocket";

interface Props {
  size: number;
  orbitRadius: number;
  label: string;
  keyId: string;
  baseAngle: number;
  timeOffset: number;
  telemetry: Telemetry | null;
  isActive: boolean;
  observatoryMode?: boolean;
}

type NodeState = "idle" | "active" | "processing" | "completed" | "unreachable";

const STATE_STYLES: Record<
  NodeState,
  { fill: string; glow: string; pulse: [number, number]; label: string; ring: string }
> = {
  idle: {
    fill: "#1e293b",
    glow: "rgba(30,41,59,0.4)",
    pulse: [0.08, 0.25],
    label: "#52525b",
    ring: "rgba(45,212,191,0.06)",
  },
  active: {
    fill: "#2dd4bf",
    glow: "rgba(45,212,191,0.4)",
    pulse: [0.3, 0.7],
    label: "#2dd4bf",
    ring: "rgba(45,212,191,0.3)",
  },
  processing: {
    fill: "#f59e0b",
    glow: "rgba(245,158,11,0.35)",
    pulse: [0.4, 0.8],
    label: "#f59e0b",
    ring: "rgba(245,158,11,0.25)",
  },
  completed: {
    fill: "#34d399",
    glow: "rgba(52,211,153,0.45)",
    pulse: [0.05, 0.4],
    label: "#34d399",
    ring: "rgba(52,211,153,0.2)",
  },
  unreachable: {
    fill: "#450a0a",
    glow: "rgba(239,68,68,0.15)",
    pulse: [0.05, 0.15],
    label: "#7f1d1d",
    ring: "rgba(239,68,68,0.05)",
  },
};

const INFERENCE_STAGES = new Set(["Response Generator"]);

function resolveState(key: string, t: Telemetry | null, isActive: boolean): NodeState {
  if (!t) return "unreachable";
  if (isActive) return "active";
  const cpuHigh = t.cpu.percent > 80 || t.gpu.gpu_util > 80;
  const cpuMed = t.cpu.percent > 50 || t.gpu.gpu_util > 50;

  if (INFERENCE_STAGES.has(key)) {
    if (t.ollama.status !== "ok") return "unreachable";
    if (cpuHigh) return "processing";
    return cpuMed ? "active" : "idle";
  }
  return "idle";
}

export default function StageNode({
  size,
  orbitRadius,
  label,
  keyId,
  baseAngle,
  timeOffset,
  telemetry,
  isActive,
  observatoryMode = false,
}: Props) {
  const CX = size / 2;
  const CY = size / 2;
  const NODE_R = 14;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const angle = baseAngle + timeOffset;
  const rad = (angle * Math.PI) / 180;
  const x = CX + orbitRadius * Math.cos(rad);
  const y = CY + orbitRadius * Math.sin(rad);

  const state = useMemo(() => resolveState(keyId, telemetry, isActive), [keyId, telemetry, isActive]);
  const style = STATE_STYLES[state];

  const isUnreachable = state === "unreachable";

  return (
    <motion.g
      initial={false}
      animate={{
        x: x - (CX + orbitRadius * Math.cos((baseAngle) * Math.PI / 180)),
        y: y - (CY + orbitRadius * Math.sin((baseAngle) * Math.PI / 180)),
      }}
      transition={{ duration: 2, ease: "linear" }}
    >
      {/* Health glow ring — visible on active/processing states */}
      {(state === "active" || state === "processing") && (
        <circle cx={x} cy={y} r={NODE_R + 18}
          fill="none" stroke={style.ring} strokeWidth="1"
        >
          <animate attributeName="opacity" values="0.1;0.4;0.1" dur="3s" repeatCount="indefinite"
            calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
        </circle>
      )}

      {/* Completed glow ring — slow subtle pulse */}
      {state === "completed" && (
        <circle cx={x} cy={y} r={NODE_R + 14}
          fill="none" stroke={style.ring} strokeWidth="0.8"
        >
          <animate attributeName="opacity" values="0.05;0.25;0.05" dur="4s" repeatCount="indefinite"
            calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
        </circle>
      )}

      {/* Unreachable — broken knot & nebula scatter */}
      {isUnreachable && (
        <>
          {/* Broken Celtic knot — frayed and disconnected */}
          <g opacity="0.15" fill="none" stroke="#7f1d1d" strokeWidth="0.5">
            <path d={`M ${x - 14} ${y - 8} C ${x - 10} ${y - 16}, ${x + 4} ${y - 12}, ${x + 6} ${y - 4} C ${x + 8} ${y + 4}, ${x - 2} ${y + 10}, ${x - 8} ${y + 6} C ${x - 14} ${y + 2}, ${x - 16} ${y - 4}, ${x - 12} ${y - 6}`} />
            <path d={`M ${x - 12} ${y - 6} C ${x - 16} ${y - 10}, ${x - 18} ${y - 12}, ${x - 20} ${y - 14}`} strokeWidth="0.3" opacity="0.3" />
            <path d={`M ${x + 6} ${y - 4} C ${x + 10} ${y - 2}, ${x + 12} ${y}, ${x + 14} ${y + 2}`} strokeWidth="0.3" opacity="0.3" />
          </g>
          {/* Tarnished gold — oxidized illumination */}
          <g opacity="0.06">
            <rect x={x - 18} y={y - 12} width="4" height="24" fill="#7f1d1d" rx="1" transform={`rotate(-5 ${x - 16} ${y})`} />
            <rect x={x + 14} y={y - 8} width="3" height="16" fill="#7f1d1d" rx="1" transform={`rotate(3 ${x + 15} ${y})`} />
          </g>
          {/* Scattered nebula particles — uncertainty field */}
          <g opacity="0.12">
            {[
              { dx: -8, dy: -10, r: 1.5, dur: 6 },
              { dx: 10, dy: 8, r: 1, dur: 5 },
              { dx: -5, dy: 12, r: 1.2, dur: 7 },
              { dx: 12, dy: -6, r: 0.8, dur: 4.5 },
            ].map((p, i) => (
              <motion.circle key={`nebula-${i}`}
                cx={x + p.dx} cy={y + p.dy} r={p.r}
                fill="#2dd4bf"
                animate={mounted ? {
                  x: [x + p.dx, x + p.dx + 8, x + p.dx - 4, x + p.dx],
                  y: [y + p.dy, y + p.dy - 6, y + p.dy + 4, y + p.dy],
                  opacity: [0.12, 0.35, 0.08, 0.12],
                } : {}}
                transition={{ duration: p.dur, repeat: Infinity, ease: "easeInOut", delay: i * 0.8 }}
              />
            ))}
          </g>
          {/* Faint repair thread — golden dashed line */}
          <path d={`M ${x - 20} ${y - 14} Q ${x - 8} ${y - 18} ${x + 14} ${y + 2}`}
            fill="none" stroke="#fbbf24" strokeWidth="0.2" strokeDasharray="2 4" opacity="0.04"
          >
            <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="3s" repeatCount="indefinite" />
          </path>
          {/* Faded crimson ring */}
          <circle cx={x} cy={y} r={NODE_R + 12}
            fill="none" stroke="rgba(239,68,68,0.08)" strokeWidth="0.5"
          >
            <animate attributeName="opacity" values="0.02;0.1;0.02" dur="5s" repeatCount="indefinite"
              calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
            <animate attributeName="r" values={`${NODE_R + 12};${(NODE_R + 12) * 1.03};${NODE_R + 12}`} dur="5s" repeatCount="indefinite"
              calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
          </circle>
        </>
      )}

      {/* Node aura */}
      <motion.circle cx={x} cy={y} r={NODE_R + 8} fill={style.glow}
        animate={mounted ? {
          opacity: style.pulse,
          scale: [1, 1.1, 1],
        } : {}}
        transition={{
          duration: isActive ? 2 : isUnreachable ? 5 : 3.5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{ originX: x, originY: y }}
      />

      {/* Node body */}
      <circle cx={x} cy={y} r={NODE_R}
        fill={isUnreachable ? "#0a0a1a" : "#0c1124"}
        stroke={style.fill}
        strokeWidth={isActive ? 2.5 : isUnreachable ? 1 : 2}
        opacity={isUnreachable ? 0.5 : 1}
      />

      {/* Node inner pulse */}
      <motion.circle cx={x} cy={y} r={isActive ? 6 : 4} fill={style.fill}
        animate={mounted ? {
          opacity: isActive ? [0.7, 1, 0.7] : [0.3, 0.7, 0.3],
          scale: [1, 1.3, 1],
        } : {}}
        transition={{
          duration: isActive ? 1.2 : isUnreachable ? 4 : 2.5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{ originX: x, originY: y }}
      />

      {/* Label */}
      <text x={x} y={y + NODE_R + 18}
        textAnchor="middle" fill={style.label} fontSize="11"
        fontFamily="var(--font-geist-mono, monospace)"
        fontWeight={isActive ? "bold" : "normal"}
        opacity={isUnreachable ? 0.4 : 1}
      >
        {label}
      </text>
    </motion.g>
  );
}
