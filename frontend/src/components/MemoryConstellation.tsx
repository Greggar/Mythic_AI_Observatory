"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
const W = 280;
const H = 280;
const CX = W / 2;
const CY = H / 2;

interface HistoryEntry {
  id: string;
  prompt: string;
  status: string;
  created_at: string;
  output: string | null;
  steps: { duration_ms: number | null }[];
}

interface Props {
  onSelect: (traceId: string) => void;
  refreshTrigger: number;
}

function computeSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).slice(0, 15));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).slice(0, 15));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let common = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) common++;
  }
  return common / Math.max(wordsA.size + wordsB.size - common, 1);
}

interface CurrentRing {
  radius: number;
  amplitude: number;
  frequency: number;
  speed: number;
  numParticles: number;
  strokeWidth: number;
  opacity: number;
  dashArray: string;
}

const RINGS: CurrentRing[] = [
  { radius: 45, amplitude: 8, frequency: 5, speed: 70, numParticles: 12, strokeWidth: 0.8, opacity: 0.08, dashArray: "3 10" },
  { radius: 75, amplitude: 12, frequency: 4, speed: 55, numParticles: 16, strokeWidth: 1.2, opacity: 0.12, dashArray: "4 12" },
  { radius: 105, amplitude: 15, frequency: 6, speed: 90, numParticles: 20, strokeWidth: 0.8, opacity: 0.08, dashArray: "2 14" },
];

function generateRingPath(ring: CurrentRing): string {
  const pts = 32;
  let d = "";
  for (let i = 0; i <= pts; i++) {
    const theta = (i / pts) * Math.PI * 2;
    const r = ring.radius + ring.amplitude * Math.sin(ring.frequency * theta);
    d += `${i === 0 ? "M" : "L"}${(CX + r * Math.cos(theta)).toFixed(4)} ${(CY + r * Math.sin(theta)).toFixed(4)}`;
  }
  return d;
}

function getParticlePosition(ring: CurrentRing, progress: number): { x: number; y: number } {
  const theta = progress * Math.PI * 2;
  const r = ring.radius + ring.amplitude * Math.sin(ring.frequency * theta);
  return {
    x: CX + r * Math.cos(theta),
    y: CY + r * Math.sin(theta),
  };
}

export default function MemoryConstellation({ onSelect, refreshTrigger }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/api/traces?limit=40`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setEntries(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshTrigger]);

  const ringPaths = useMemo(() => RINGS.map(generateRingPath), []);

  const ringParticles = useMemo(
    () =>
      RINGS.map((ring) =>
        Array.from({ length: ring.numParticles }, (_, i) => getParticlePosition(ring, i / ring.numParticles))
      ),
    []
  );

  const tracePositions = useMemo(() => {
    if (entries.length === 0) return [];
    const sorted = [...entries].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return sorted.map((entry, i) => {
      const angle = (i / sorted.length) * 360 - 90;
      const rad = (angle * Math.PI) / 180;
      const t = i / Math.max(sorted.length - 1, 1);
      const dist = 25 + (1 - t) * 80;
      let simSum = 0;
      let simCount = 0;
      for (let j = 0; j < sorted.length; j++) {
        if (i !== j) {
          const s = computeSimilarity(entry.prompt, sorted[j].prompt);
          if (s > 0.15) { simSum += s; simCount++; }
        }
      }
      const avgSim = simCount > 0 ? simSum / simCount : 0;
      const connections: number[] = [];
      for (let j = 0; j < sorted.length; j++) {
        if (i !== j && computeSimilarity(entry.prompt, sorted[j].prompt) > 0.2) connections.push(j);
      }
      return {
        entry,
        x: CX + dist * Math.cos(rad),
        y: CY + dist * Math.sin(rad),
        sim: avgSim,
        isRecent: i < 5,
        index: i,
        connections: connections.slice(0, 3),
      };
    });
  }, [entries]);

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex flex-col items-center gap-1.5 text-teal-mystic">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 2a10 10 0 1010 10" />
          <path d="M12 2v10l6 6" opacity="0.6" />
          <circle cx="12" cy="12" r="2" opacity="0.4" />
        </svg>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
            Memory Retrieval
          </span>
          {loading && (
            <motion.span
              className="inline-block w-1.5 h-1.5 rounded-full bg-teal-mystic"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          )}
        </div>
      </div>

      <div
        className="relative overflow-hidden rounded-lg"
        style={{ background: "linear-gradient(180deg, #041824 0%, #0a2d38 50%, #06303d 100%)" }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          <defs>
            <radialGradient id="ocn-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(45,212,191,0.05)" />
              <stop offset="100%" stopColor="rgba(45,212,191,0)" />
            </radialGradient>
          </defs>

          <rect x={0} y={0} width={W} height={H} rx={8} fill="url(#ocn-glow)" />

          {/* Current rings */}
          {RINGS.map((ring, ri) => (
            <g key={`ring-${ri}`}>
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`0 ${CX} ${CY}`}
                to={`360 ${CX} ${CY}`}
                dur={`${ring.speed}s`}
                repeatCount="indefinite"
              />
              <path
                d={ringPaths[ri]}
                fill="none"
                stroke={`rgba(45,212,191,${ring.opacity})`}
                strokeWidth={ring.strokeWidth}
                strokeDasharray={ring.dashArray}
                strokeLinecap="round"
              >
                <animate attributeName="stroke-dashoffset" from="200" to="0" dur={`${ring.speed * 0.6}s`} repeatCount="indefinite" />
              </path>
              {ringParticles[ri].map((pos, pi) => (
                <circle key={pi} cx={pos.x} cy={pos.y}
                  r={1 + (pi % 3) * 0.5} fill="#5eead4"
                >
                  <animate attributeName="opacity" values="0.3;0.7;0.3" dur={`${2 + (pi % 3) * 1.5}s`} begin={`${pi * 0.3}s`} repeatCount="indefinite"
                    calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
                  <animate attributeName="r" values={`${1 + (pi % 3) * 0.5};${(1 + (pi % 3) * 0.5) * 1.4};${1 + (pi % 3) * 0.5}`} dur={`${2 + (pi % 3) * 1.5}s`} begin={`${pi * 0.3}s`} repeatCount="indefinite"
                    calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
                </circle>
              ))}
            </g>
          ))}

          {/* Rising memory particles — surface from deep ocean (Concept 3) */}
          {[
            { cx: CX - 30, cy: CY + 60, dur: 6, delay: 0 },
            { cx: CX + 40, cy: CY + 70, dur: 7, delay: 1 },
            { cx: CX - 50, cy: CY + 50, dur: 5.5, delay: 0.5 },
            { cx: CX + 20, cy: CY + 80, dur: 8, delay: 2 },
            { cx: CX - 10, cy: CY + 65, dur: 6.5, delay: 1.5 },
          ].map((p, i) => (
            <circle key={`rise-${i}`} r={1.5} fill="#2dd4bf">
              <animate attributeName="cy" values={`${p.cy};${CY - 60}`} dur={`${p.dur}s`} begin={`${p.delay}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;0.5;0.5;0" dur={`${p.dur}s`} begin={`${p.delay}s`} repeatCount="indefinite"
                keyTimes="0;0.3;0.7;1" />
            </circle>
          ))}

          {/* Deep center glow */}
          <circle cx={CX} cy={CY} r={50} fill="url(#ocn-glow)" />
          <circle cx={CX} cy={CY} r={2.5} fill="rgba(45,212,191,0.2)" />
          <circle cx={CX} cy={CY} r={1} fill="rgba(94,234,212,0.4)" />

          {/* Connection filaments between similar traces */}
          {tracePositions.map((trace) =>
            trace.connections.map((connIdx) => {
              if (connIdx >= tracePositions.length) return null;
              const other = tracePositions[connIdx];
              return (
                <motion.line
                  key={`conn-${trace.index}-${connIdx}`}
                  x1={trace.x}
                  y1={trace.y}
                  x2={other.x}
                  y2={other.y}
                  stroke="rgba(45,212,191,0.05)"
                  strokeWidth={0.4}
                  initial={{ opacity: 0 }}
                  animate={mounted ? { opacity: trace.sim * 0.15 } : {}}
                  transition={{ duration: 1.5, delay: trace.index * 0.1 }}
                />
              );
            })
          )}

          {/* Trace eddies — glowing vortices */}
          {tracePositions.map((trace) => (
            <motion.g
              key={trace.entry.id}
              onClick={() => onSelect(trace.entry.id)}
              style={{ cursor: "pointer" }}
              initial={{ opacity: 0, scale: 0 }}
              animate={mounted ? { opacity: 1, scale: 1 } : {}}
              transition={{ duration: 0.6, delay: trace.index * 0.05, ease: "easeOut" }}
              whileHover={{ scale: 1.5 }}
            >
              {/* Outer ring */}
              <circle
                cx={trace.x}
                cy={trace.y}
                r={3 + trace.sim * 3}
                fill="none"
                stroke={trace.isRecent ? "rgba(45,212,191,0.3)" : "rgba(45,212,191,0.12)"}
                strokeWidth={0.5}
              />
              {/* Core */}
              <circle
                cx={trace.x}
                cy={trace.y}
                r={1.5 + trace.sim * 1.5}
                fill={trace.isRecent ? "#2dd4bf" : "rgba(45,212,191,0.5)"}
              />
            </motion.g>
          ))}
        </svg>
      </div>
    </div>
  );
}
