"use client";

import { useEffect, useState, useCallback } from "react";
import type { Telemetry } from "@/hooks/useWebSocket";
import BackgroundAtmosphere from "./BackgroundAtmosphere";
import SacredGeometry from "./SacredGeometry";
import OrchestrationRing from "./OrchestrationRing";
import SolarCore from "./SolarCore";
import AgentNode from "./AgentNode";
import EnergyPath from "./EnergyPath";
import ThoughtStream from "./ThoughtStream";

interface Props {
  telemetry: Telemetry | null;
  traceActive: boolean;
  activeTraceStep: number | null;
  phase?: "idle" | "replaying" | "complete";
  observatoryMode?: boolean;
}

const SIZE = 800;
const CX = SIZE / 2;
const CY = SIZE / 2;
const OUTER_ORBIT = 260;
const NODE_R = 14;

interface NodeDef {
  label: string;
  key: string;
  angle: number;
}

const ORBIT_NODES: NodeDef[] = [
  { label: "Ollama", key: "ollama", angle: -90 },
  { label: "OpenClaw", key: "openclaw", angle: -18 },
  { label: "Hermes", key: "hermes", angle: 54 },
  { label: "ComfyUI", key: "comfyui", angle: 126 },
  { label: "System", key: "system", angle: 198 },
];

const RINGS = [
  { radius: 50, strokeWidth: 0.5, speed: -30, dashArray: "2 12", opacity: 0.2 },
  { radius: 110, strokeWidth: 0.5, speed: 45, dashArray: "1 18", opacity: 0.15 },
  { radius: 170, strokeWidth: 0.5, speed: -60, dashArray: "1 24", opacity: 0.12 },
  { radius: OUTER_ORBIT + 15, strokeWidth: 0.8, speed: 80, opacity: 0.1 },
  { radius: OUTER_ORBIT - 15, strokeWidth: 0.4, speed: -95, dashArray: "3 15", opacity: 0.08 },
];

function pos(deg: number, r = OUTER_ORBIT) {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

const STEP_NODE_MAP: Record<number, string | null> = {
  0: null,
  1: null,
  2: "openclaw",
  3: "ollama",
  4: null,
  5: null,
  6: null,
};

export default function SolarNexus({
  telemetry,
  traceActive,
  activeTraceStep,
  phase = "idle",
  observatoryMode = false,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [timeOffset, setTimeOffset] = useState(0);
  const [driftAccel, setDriftAccel] = useState(1);
  useEffect(() => setMounted(true), []);

  // Observatory mode: slower drift, but if idle for a while we also slow down
  useEffect(() => {
    if (!mounted) return;
    setDriftAccel(observatoryMode ? 0.5 : 1);
  }, [observatoryMode, mounted]);

  // orbital drift
  useEffect(() => {
    if (!mounted) return;
    const interval = setInterval(() => {
      setTimeOffset((prev) => (prev + 0.12 * driftAccel) % 360);
    }, 1000);
    return () => clearInterval(interval);
  }, [mounted, driftAccel]);

  const highlightedNode =
    activeTraceStep !== null && activeTraceStep !== undefined
      ? STEP_NODE_MAP[activeTraceStep] ?? null
      : null;

  const activePathways =
    activeTraceStep !== null && activeTraceStep !== undefined
      ? [2, 3, 4].includes(activeTraceStep)
      : false;

  const conductorState = (() => {
    if (!telemetry) return "offline";
    if (telemetry.cpu.percent > 80 || telemetry.gpu.gpu_util > 80)
      return "heavy_load";
    if (telemetry.cpu.percent > 50 || telemetry.gpu.gpu_util > 50)
      return "processing";
    return "online";
  })();

  // Observatory mode: cycle through phase states periodically
  const observatoryPhase = observatoryMode && phase === "idle"
    ? ((Math.floor(Date.now() / 8000) % 8) as 0 | 1 | 2 | 3 | 4 | 5 | 6)
    : null;

  return (
    <div className="relative glass-panel p-5 flex items-center justify-center overflow-hidden">
      <BackgroundAtmosphere />

      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="relative w-full max-w-[600px] h-auto"
        style={{ zIndex: 1 }}
      >
        {/* Sacred geometry layer */}
        <SacredGeometry size={SIZE} cx={CX} cy={CY} observatoryMode={observatoryMode} />

        {/* Orchestration rings */}
        <OrchestrationRing size={SIZE} rings={RINGS} observatoryMode={observatoryMode} />

        {/* Conductor core */}
        <SolarCore
          size={SIZE}
          traceActive={traceActive}
          traceStep={observatoryPhase !== null ? observatoryPhase : activeTraceStep}
          conductorState={conductorState}
          observatoryMode={observatoryMode}
        />

        {/* Agent Thought Streams — visualise cognition during each stage (or in observatory mode) */}
        {(phase !== "idle" || observatoryMode) && (
          <ThoughtStream
            size={SIZE}
            cx={CX}
            cy={CY}
            activeStepIndex={observatoryPhase !== null ? observatoryPhase : activeTraceStep}
            phase={observatoryMode ? "replaying" : phase}
            stepOutputs={{}}
          />
        )}

        {/* Energy pathways — pentagram chords (agent relationships) */}
        {ORBIT_NODES.map((_, i) => {
          const starIndices = [0, 2, 4, 1, 3, 0];
          if (i >= starIndices.length - 1) return null;
          const a = pos(ORBIT_NODES[starIndices[i]].angle, OUTER_ORBIT);
          const b = pos(ORBIT_NODES[starIndices[i + 1]].angle, OUTER_ORBIT);
          const influence = activePathways ? 0.4 : 0;
          return (
            <EnergyPath
              key={`star-${i}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              active={activePathways}
              influence={influence}
              index={i}
            />
          );
        })}

        {/* Energy pathways — conductor to each node */}
        {ORBIT_NODES.map((node, i) => {
          const p = pos(node.angle, OUTER_ORBIT);
          const isActive = highlightedNode === node.key;
          // Influence weighting: active node = 1.0, nodes in trace path = 0.5, rest = 0.1
          const influence = isActive ? 1 : (activePathways ? 0.5 : 0.1);
          return (
            <EnergyPath
              key={`radial-${node.key}`}
              x1={CX}
              y1={CY}
              x2={p.x}
              y2={p.y}
              active={isActive || activePathways}
              influence={influence}
              index={i + 5}
            />
          );
        })}

        {/* Agent nodes */}
        {ORBIT_NODES.map((node) => (
          <AgentNode
            key={node.key}
            size={SIZE}
            orbitRadius={OUTER_ORBIT}
            label={node.label}
            keyId={node.key}
            baseAngle={node.angle}
            timeOffset={timeOffset}
            telemetry={telemetry}
            isActive={highlightedNode === node.key}
            observatoryMode={observatoryMode}
          />
        ))}

        {/* Orbital labels */}
        {ORBIT_NODES.map((node) => {
          const p = pos(node.angle, OUTER_ORBIT);
          return (
            <text
              key={`label-${node.key}`}
              x={p.x}
              y={p.y + NODE_R + 18}
              textAnchor="middle"
              fill="transparent"
              fontSize="11"
              fontFamily="var(--font-geist-mono, monospace)"
            >
              {node.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
