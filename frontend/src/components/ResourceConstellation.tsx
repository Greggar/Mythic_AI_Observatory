"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

interface Vital {
  id: string;
  label: string;
  value: string;
  status: string;
}

interface Machine {
  id: string;
  name: string;
  desc: string;
  insight: string;
  status: "healthy" | "warning" | "critical";
  vitals: Vital[];
}

interface VitalsData {
  machines: Machine[];
}

const STATUS_GLOW: Record<string, string> = {
  healthy: "#34d399",
  warning: "#f59e0b",
  critical: "#ef4444",
};

const STATUS_COLORS: Record<string, string> = {
  green: "#34d399",
  yellow: "#f59e0b",
  red: "#ef4444",
};

function parsePct(value: string): number {
  const m = value.match(/^([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

function getVital(machine: Machine, id: string): Vital | undefined {
  return machine.vitals.find((v) => v.id === id);
}

const SERVICE_GLYPHS: Record<string, { x: number; y: number; label: string; color: string }[]> = {
  Gingerlong: [
    { x: 0, y: -14, label: "API", color: "#2dd4bf" },
    { x: 12, y: -7, label: "Ollama", color: "#34d399" },
    { x: 12, y: 7, label: "OC", color: "#fbbf24" },
    { x: 0, y: 14, label: "UI", color: "#2dd4bf" },
    { x: -12, y: 7, label: "FastAPI", color: "#34d399" },
    { x: -12, y: -7, label: "Conductor", color: "#fbbf24" },
  ],
  BackOffice: [
    { x: 0, y: -11, label: "Hermes", color: "#2dd4bf" },
    { x: 10, y: 0, label: "ComfyUI", color: "#a78bfa" },
    { x: 0, y: 11, label: "qwen3.5", color: "#34d399" },
  ],
  LoungeRoom: [
    { x: 0, y: -9, label: "Batch", color: "#2dd4bf" },
    { x: 0, y: 9, label: "Train", color: "#f59e0b" },
  ],
};

const SERVICE_INFO: Record<string, { name: string; desc: string }> = {
  Conductor: { name: "Conductor", desc: "FastAPI backend — orchestrates 7-stage AI pipeline, manages telemetry, serves REST API" },
  API: { name: "API", desc: "REST API endpoints for frontend communication, trace management, and config" },
  Ollama: { name: "Ollama", desc: "Local LLM inference server — runs qwen2.5:3b for CPU-bound orchestration calls" },
  OC: { name: "OpenClaw Gateway", desc: "Agent gateway — connects to Telegram, manages multi-model routing; amber = degraded or disconnected channel" },
  UI: { name: "Solar Interface", desc: "Next.js frontend — glassmorphic dashboard served on port 3001" },
  FastAPI: { name: "FastAPI", desc: "ASGI web framework powering the Conductor backend" },
  Hermes: { name: "Hermes Agent", desc: "AI agent on BackOffice — handles prompt processing and tool calls" },
  ComfyUI: { name: "ComfyUI", desc: "Image generation interface running on BackOffice" },
  "qwen3.5": { name: "Qwen 3.5", desc: "Local LLM model (3B params) running on BackOffice for inference offload" },
  Batch: { name: "Batch Processor", desc: "Background batch job runner on LoungeRoom" },
  Train: { name: "Train Worker", desc: "Model fine-tuning / training worker on LoungeRoom" },
};

interface ConstellationProps {
  active?: boolean;
}

export default function ResourceConstellation({ active }: ConstellationProps) {
  const CX = 500;
  const CY = 500;
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<VitalsData | null>(null);
  const [hovered, setHovered] = useState<{ label: string; x: number; y: number; target?: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const clearHover = useCallback(() => {
    hoverTimeout.current = setTimeout(() => setHovered(null), 150);
  }, []);

  const keepHover = useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
  }, []);

  const handleMouseEnter = useCallback((e: React.MouseEvent, label: string, target?: string) => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setHovered({ label, x: e.clientX - rect.left, y: e.clientY - rect.top, target });
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    let cancelled = false;
    let interval: ReturnType<typeof setInterval>;

    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/api/vitals`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // silently fail
      }
      if (!cancelled) interval = setTimeout(poll, 3000);
    }
    poll();

    return () => {
      cancelled = true;
      clearTimeout(interval);
    };
  }, []);

  const sun = useMemo(() => data?.machines.find((m) => m.name === "Gingerlong") ?? null, [data]);
  const planets = useMemo(
    () => data?.machines.filter((m) => m.name !== "Gingerlong") ?? [],
    [data]
  );

  const ORBIT_RADII = [255, 390, 525];
  const ORBIT_SPEEDS = [55, -40, 65];

  return (
    <div className="glass-panel p-5 flex flex-col items-center gap-3" ref={containerRef}>
      <div className="flex flex-col items-center gap-1.5 text-teal-mystic">
        <Activity size={16} />
        <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
          System Orbit
        </span>
      </div>

      <svg viewBox="0 0 1000 1000" className="w-full max-w-[500px] h-auto">
        {/* Orbital rings */}
        {planets.map((_, i) => (
          <circle
            key={`orbit-${i}`}
            cx={CX}
            cy={CY}
            r={ORBIT_RADII[i] ?? 70}
            fill="none"
            stroke="oklch(58% 0.15 75 / 0.25)"
            strokeWidth="1.5"
            strokeDasharray="6 10"
          />
        ))}

        {/* Solar core — GingerLongServer */}
        {sun && (
          <g>
            {/* Solar aura */}
            <motion.circle
              cx={CX} cy={CY} r={100}
              fill="url(#sunGlow)"
              animate={mounted ? { scale: [1, 1.08, 1], opacity: [0.3, 0.6, 0.3] } : {}}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              style={{ transformOrigin: "50% 50%" }}
            />
            {/* Core */}
            <circle cx={CX} cy={CY} r={40} fill="#0c1124" stroke={STATUS_GLOW[sun.status]} strokeWidth="5" />
            <motion.circle
              cx={CX} cy={CY} r={24}
              fill={STATUS_GLOW[sun.status]}
              animate={mounted ? { opacity: [0.3, 0.7, 0.3] } : {}}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            />
            {/* Centre label */}
            <text x={CX} y={CY + 80} textAnchor="middle" fill={STATUS_GLOW[sun.status]}
              fontSize="24" fontFamily="monospace" fontWeight="bold" letterSpacing="0.1em">
              {sun.name.toUpperCase()}
            </text>
            {/* Services around sun */}
            {SERVICE_GLYPHS[sun.name]?.map((s, i) => (
              <g key={`sun-svc-${i}`}
                onMouseEnter={(e) => handleMouseEnter(e, s.label, sun.name)}
                onMouseLeave={clearHover}
                style={{ cursor: "pointer" }}
              >
                {active ? (
                  <motion.circle
                    cx={CX + s.x * 10} cy={CY + s.y * 10} r={8}
                    fill={s.color}
                    animate={{ opacity: [0.4, 1, 0.4], r: [8, 10, 8] }}
                    transition={{ duration: 2, delay: i * 0.2, repeat: Infinity, ease: "easeInOut" }}
                  />
                ) : (
                  <circle cx={CX + s.x * 10} cy={CY + s.y * 10} r={8} fill={s.color} opacity="0.7" />
                )}
                <text x={CX + s.x * 10} y={CY + s.y * 10 - 16}
                  textAnchor="middle" fill="oklch(72% 0.11 75 / 0.5)" fontSize="22" fontFamily="monospace">
                  {s.label}
                </text>
              </g>
            ))}
            {/* Subtitle under sun label */}
            <text x={CX} y={CY + 108} textAnchor="middle"
              fill="oklch(52% 0.03 265 / 0.5)" fontSize="16" fontFamily="monospace">
              conductor
            </text>
          </g>
        )}

        {/* Orbiting planets */}
        {planets.map((machine, i) => {
          const cpu = parsePct(getVital(machine, "cpu")?.value ?? "0");
          const mem = parsePct(getVital(machine, "mem")?.value ?? "0");
          const planetSize = 20 + (mem / 100) * 46;
          const brightness = 0.6 + (cpu / 100) * 0.35;
          const isActive = cpu > 20;
          const color = STATUS_GLOW[machine.status];

          const orbitR = ORBIT_RADII[i] ?? 70;
          const speed = ORBIT_SPEEDS[i] ?? 50;

          return (
            <motion.g
              key={machine.id}
              style={{ transformOrigin: "50% 50%" }}
              initial={{ rotate: i * (360 / planets.length) }}
              animate={mounted ? { rotate: i * (360 / planets.length) + 360 } : { rotate: i * (360 / planets.length) }}
              transition={{ duration: Math.abs(speed), repeat: Infinity, ease: "linear", delay: 0 }}
            >
              <g
                onMouseEnter={(e) => handleMouseEnter(e, machine.name)}
                onMouseLeave={clearHover}
                style={{ cursor: "pointer" }}
              >
                {/* Active workload halo */}
                {isActive && (
                  <motion.circle
                    cx={CX + orbitR} cy={CY}
                    r={planetSize + 20}
                    fill={color}
                    opacity="0.08"
                    animate={{ opacity: [0.05, 0.15, 0.05] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                  />
                )}
                {/* Planet body */}
                <circle
                  cx={CX + orbitR} cy={CY}
                  r={planetSize}
                  fill="#0c1124"
                  stroke={color}
                  strokeWidth="3"
                  opacity={brightness}
                />
                {/* Planet core glow */}
                <motion.circle
                  cx={CX + orbitR} cy={CY}
                  r={planetSize * 0.4}
                  fill={color}
                  opacity={1}
                  animate={mounted ? { opacity: [0.5, brightness + 0.2, 0.5] } : {}}
                  transition={{ duration: 2 + i, repeat: Infinity, ease: "easeInOut" }}
                />
                {/* Planet label */}
                <text x={CX + orbitR} y={CY + planetSize + 46}
                  textAnchor="middle" fill="oklch(72% 0.11 75 / 0.7)"
                  fontSize="26" fontFamily="monospace" fontWeight="bold">
                  {machine.name.toUpperCase()}
                </text>
                {/* CPU/RAM stats under label */}
                <text x={CX + orbitR} y={CY + planetSize + 70}
                  textAnchor="middle" fill="oklch(52% 0.03 265 / 0.5)"
                  fontSize="18" fontFamily="monospace">
                  CPU {cpu.toFixed(0)}% · RAM {mem.toFixed(0)}%
                </text>
                {/* Service glyphs around planet */}
                {SERVICE_GLYPHS[machine.name]?.map((s, j) => (
                  <g key={j}
                    onMouseEnter={(e) => handleMouseEnter(e, s.label, machine.name)}
                    onMouseLeave={clearHover}
                    style={{ cursor: "pointer" }}
                  >
                    {active ? (
                      <motion.circle
                        cx={CX + orbitR + s.x * 3.3}
                        cy={CY + s.y * 3.3}
                        r={4} fill={s.color}
                        animate={{ opacity: [0.4, 1, 0.4], r: [4, 6, 4] }}
                        transition={{ duration: 2.5, delay: j * 0.3, repeat: Infinity, ease: "easeInOut" }}
                      />
                    ) : (
                      <circle
                        cx={CX + orbitR + s.x * 3.3}
                        cy={CY + s.y * 3.3}
                        r={4} fill={s.color} opacity="0.7"
                      />
                    )}
                    <text
                      x={CX + orbitR + s.x * 3.3}
                      y={CY + s.y * 3.3 - 9}
                      textAnchor="middle" fill="oklch(52% 0.03 265 / 0.5)"
                      fontSize="8" fontFamily="monospace">
                      {s.label}
                    </text>
                  </g>
                ))}
              </g>
            </motion.g>
          );
        })}

        {/* Defs for gradients */}
        <defs>
          <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.4" />
            <stop offset="40%" stopColor="#f59e0b" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>

      {/* Tooltip */}
      {hovered && (() => {
        const info = SERVICE_INFO[hovered.label];
        const gap = 10;
        const cw = containerRef.current?.clientWidth ?? 500;
        const midX = cw / 2;
        const onRight = hovered.x > midX;
        const left = onRight ? hovered.x - 220 - gap : hovered.x + gap;
        const ch = containerRef.current?.clientHeight ?? 400;
        const onBottom = hovered.y > ch / 2;
        const top = onBottom ? hovered.y - 10 : hovered.y + 10;
        return (
          <div
            className="absolute z-10"
            style={{ left, top, transform: onBottom ? "translateY(-100%)" : "none" }}
            onMouseEnter={keepHover}
            onMouseLeave={clearHover}
          >
            <div className="bg-[rgba(6,30,40,0.92)] backdrop-blur-sm border border-teal-mystic/20 rounded-md px-3 py-2 shadow-lg max-w-[220px]">
              <p className="text-[11px] font-semibold text-teal-mystic/90">
                {info?.name || hovered.label}
              </p>
              {info?.desc && (
                <p className="text-[9px] leading-tight text-zinc-400 mt-0.5">{info.desc}</p>
              )}
              {hovered.target && hovered.label !== hovered.target && (
                <p className="text-[8px] text-zinc-600 mt-1">on {hovered.target}</p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Legend footer */}
      <div className="flex items-center gap-4 text-[10px] font-mono text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#34d399]" />
          Healthy
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#f59e0b]" />
          Warning
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#ef4444]" />
          Critical
        </span>
      </div>
    </div>
  );
}
