"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
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

export default function ResourceConstellation() {
  const CX = 100;
  const CY = 100;
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<VitalsData | null>(null);

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

  const ORBIT_RADII = [65, 95, 125];
  const ORBIT_SPEEDS = [55, -40, 65];

  return (
    <div className="glass-panel p-5 flex flex-col items-center gap-3">
      <div className="flex flex-col items-center gap-1.5 text-teal-mystic">
        <Activity size={16} />
        <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
          System Orbit
        </span>
      </div>

      <svg viewBox="0 0 200 200" className="w-full max-w-[400px] h-auto">
        {/* Orbital rings */}
        {planets.map((_, i) => (
          <circle
            key={`orbit-${i}`}
            cx={CX}
            cy={CY}
            r={ORBIT_RADII[i] ?? 70}
            fill="none"
            stroke="oklch(58% 0.10 75 / 0.15)"
            strokeWidth="0.4"
            strokeDasharray="2 4"
          />
        ))}

        {/* Solar core — GingerLongServer */}
        {sun && (
          <g>
            {/* Solar aura */}
            <motion.circle
              cx={CX} cy={CY} r={22}
              fill="url(#sunGlow)"
              animate={mounted ? { scale: [1, 1.08, 1], opacity: [0.3, 0.6, 0.3] } : {}}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              style={{ originX: CX, originY: CY }}
            />
            {/* Core */}
            <circle cx={CX} cy={CY} r={8} fill="#0c1124" stroke={STATUS_GLOW[sun.status]} strokeWidth="1" />
            <motion.circle
              cx={CX} cy={CY} r={5}
              fill={STATUS_GLOW[sun.status]}
              animate={mounted ? { opacity: [0.3, 0.7, 0.3] } : {}}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            />
            {/* Centre label */}
            <text x={CX} y={CY + 16} textAnchor="middle" fill={STATUS_GLOW[sun.status]}
              fontSize="5.5" fontFamily="monospace" fontWeight="bold" letterSpacing="0.1em">
              {sun.name.toUpperCase()}
            </text>
            {/* Services around sun */}
            {SERVICE_GLYPHS[sun.name]?.map((s, i) => (
              <g key={`sun-svc-${i}`}>
                <circle cx={CX + s.x} cy={CY + s.y} r={1.5} fill={s.color} opacity="0.7" />
                <text x={CX + s.x + 3} y={CY + s.y + 1.5}
                  fill="oklch(72% 0.11 75 / 0.5)" fontSize="3.5" fontFamily="monospace">
                  {s.label}
                </text>
              </g>
            ))}
            {/* Subtitle under sun label */}
            <text x={CX} y={CY + 22} textAnchor="middle"
              fill="oklch(52% 0.03 265 / 0.5)" fontSize="3.5" fontFamily="monospace">
              conductor
            </text>
          </g>
        )}

        {/* Orbiting planets */}
        {planets.map((machine, i) => {
          const cpu = parsePct(getVital(machine, "cpu")?.value ?? "0");
          const mem = parsePct(getVital(machine, "mem")?.value ?? "0");
          const planetSize = 4 + (mem / 100) * 10;
          const brightness = 0.3 + (cpu / 100) * 0.5;
          const isActive = cpu > 20;
          const color = STATUS_GLOW[machine.status];

          const orbitR = ORBIT_RADII[i] ?? 70;
          const speed = ORBIT_SPEEDS[i] ?? 50;

          return (
            <motion.g
              key={machine.id}
              style={{ originX: CX, originY: CY }}
              animate={mounted ? { rotate: 360 } : { rotate: 0 }}
              transition={{ duration: speed, repeat: Infinity, ease: "linear", delay: i * 4 }}
            >
              <g>
                {/* Active workload halo */}
                {isActive && (
                  <motion.circle
                    cx={CX + orbitR} cy={CY}
                    r={planetSize + 6}
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
                  strokeWidth="1"
                  opacity={brightness}
                />
                {/* Planet core glow */}
                <motion.circle
                  cx={CX + orbitR} cy={CY}
                  r={planetSize * 0.35}
                  fill={color}
                  opacity={brightness}
                  animate={mounted ? { opacity: [brightness * 0.4, brightness, brightness * 0.4] } : {}}
                  transition={{ duration: 2 + i, repeat: Infinity, ease: "easeInOut" }}
                />
                {/* Planet label */}
                <text x={CX + orbitR} y={CY + planetSize + 9}
                  textAnchor="middle" fill="oklch(72% 0.11 75 / 0.7)"
                  fontSize="5.5" fontFamily="monospace" fontWeight="bold">
                  {machine.name.toUpperCase()}
                </text>
                {/* CPU/RAM stats under label */}
                <text x={CX + orbitR} y={CY + planetSize + 14}
                  textAnchor="middle" fill="oklch(52% 0.03 265 / 0.5)"
                  fontSize="3.5" fontFamily="monospace">
                  CPU {cpu.toFixed(0)}% · RAM {mem.toFixed(0)}%
                </text>
                {/* Service glyphs around planet */}
                {SERVICE_GLYPHS[machine.name]?.map((s, j) => (
                  <circle key={j}
                    cx={CX + orbitR + s.x}
                    cy={CY + s.y}
                    r={1.2} fill={s.color} opacity="0.7"
                  />
                ))}
              </g>
            </motion.g>
          );
        })}

        {/* Defs for gradients */}
        <defs>
          <radialGradient id="sunGlow">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.4" />
            <stop offset="40%" stopColor="#f59e0b" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>

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
