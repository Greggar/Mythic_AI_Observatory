"use client";

import { useEffect, useState, useMemo } from "react";
import type { Telemetry } from "@/hooks/useWebSocket";
import type { TraceSession } from "@/types/trace";
import BackgroundAtmosphere from "./BackgroundAtmosphere";
import SacredGeometry from "./SacredGeometry";
import OrchestrationRing from "./OrchestrationRing";
import SolarCore from "./SolarCore";
import AgentNode from "./AgentNode";
import EnergyPath from "./EnergyPath";
import ThoughtStream from "./ThoughtStream";

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
const OUTER_ORBIT = 260;
const NODE_R = 14;

interface NodeDef {
  label: string;
  key: string;
  angle: number;
}

const ORBIT_NODES: NodeDef[] = [
  { label: "Intent Classifier", key: "Intent Classifier", angle: -90 },
  { label: "Agent Selector", key: "Agent Selector", angle: -18 },
  { label: "Memory Retriever", key: "Memory Retriever", angle: 54 },
  { label: "Context Synthesizer", key: "Context Synthesizer", angle: 126 },
  { label: "Response Generator", key: "Response Generator", angle: 198 },
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

export default function SolarNexus({
  telemetry,
  trace,
  traceActive,
  activeTraceStep,
  phase = "idle",
  observatoryMode = false,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [timeOffset, setTimeOffset] = useState(0);
  const [driftAccel, setDriftAccel] = useState(1);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    setDriftAccel(observatoryMode ? 0.5 : 1);
  }, [observatoryMode, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const interval = setInterval(() => {
      setTimeOffset((prev) => (prev + 0.12 * driftAccel) % 360);
    }, 1000);
    return () => clearInterval(interval);
  }, [mounted, driftAccel]);

  const currentAgent = useMemo(() => {
    if (activeTraceStep === null || activeTraceStep === undefined || !trace) return null;
    const step = trace.steps[activeTraceStep];
    if (!step) return null;
    return step.agent_used;
  }, [activeTraceStep, trace]);

  const highlightedNode = useMemo(() => {
    if (!currentAgent) return null;
    const match = ORBIT_NODES.find(
      (n) => n.key.toLowerCase() === currentAgent.toLowerCase()
    );
    return match?.key ?? null;
  }, [currentAgent]);

  const activePathways = highlightedNode !== null;

  const conductorState = (() => {
    if (!telemetry) return "offline";
    if (telemetry.cpu.percent > 80 || telemetry.gpu.gpu_util > 80) return "heavy_load";
    if (telemetry.cpu.percent > 50 || telemetry.gpu.gpu_util > 50) return "processing";
    return "online";
  })();

  const observatoryPhase = observatoryMode && phase === "idle"
    ? ((Math.floor(Date.now() / 8000) % 8) as 0 | 1 | 2 | 3 | 4 | 5 | 6)
    : null;

  return (
    <div className="relative glass-panel p-5 flex flex-col items-center overflow-hidden">
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
      <BackgroundAtmosphere />

      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="relative w-full max-w-[600px] h-auto"
        style={{ zIndex: 1 }}
      >
        <SacredGeometry size={SIZE} cx={CX} cy={CY} observatoryMode={observatoryMode} />

        <OrchestrationRing size={SIZE} rings={RINGS} observatoryMode={observatoryMode} />

        <SolarCore
          size={SIZE}
          traceActive={traceActive}
          traceStep={observatoryPhase !== null ? observatoryPhase : activeTraceStep}
          conductorState={conductorState}
          observatoryMode={observatoryMode}
        />

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

        {/* Energy pathways — pentagram chords between agent nodes */}
        {ORBIT_NODES.map((_, i) => {
          const starIndices = [0, 2, 4, 1, 3, 0];
          if (i >= starIndices.length - 1) return null;
          const a = pos(ORBIT_NODES[starIndices[i]].angle, OUTER_ORBIT);
          const b = pos(ORBIT_NODES[starIndices[i + 1]].angle, OUTER_ORBIT);
          const influence = activePathways ? 0.4 : 0;
          return (
            <EnergyPath
              key={`star-${i}`}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              active={activePathways}
              influence={influence}
              index={i}
            />
          );
        })}

        {/* Energy pathways — conductor to each agent node */}
        {ORBIT_NODES.map((node, i) => {
          const p = pos(node.angle, OUTER_ORBIT);
          const isActive = highlightedNode === node.key;
          const influence = isActive ? 1 : (activePathways ? 0.5 : 0.1);
          return (
            <EnergyPath
              key={`radial-${node.key}`}
              x1={CX} y1={CY} x2={p.x} y2={p.y}
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
