"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Telemetry } from "@/hooks/useWebSocket";

interface Props {
  telemetry: Telemetry | null;
}

interface CelestialBody {
  label: string;
  value: number;
  color: string;
  orbitRadius: number;
  size: number;
  speed: number;
}

function valueColor(val: number): string {
  if (val < 40) return "#34d399";
  if (val < 70) return "#2dd4bf";
  if (val < 90) return "#f59e0b";
  return "#ef4444";
}

export default function ResourceConstellation({ telemetry }: Props) {
  const CX = 100;
  const CY = 100;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const bodies: CelestialBody[] = useMemo(() => [
    {
      label: "CPU",
      value: telemetry?.cpu.percent ?? 0,
      color: valueColor(telemetry?.cpu.percent ?? 0),
      orbitRadius: 70,
      size: 10 + ((telemetry?.cpu.percent ?? 0) / 100) * 12,
      speed: 35,
    },
    {
      label: "Memory",
      value: telemetry?.memory.percent ?? 0,
      color: valueColor(telemetry?.memory.percent ?? 0),
      orbitRadius: 55,
      size: 8 + ((telemetry?.memory.percent ?? 0) / 100) * 10,
      speed: -45,
    },
    {
      label: "GPU",
      value: telemetry?.gpu.gpu_util ?? 0,
      color: valueColor(telemetry?.gpu.gpu_util ?? 0),
      orbitRadius: 85,
      size: 6 + ((telemetry?.gpu.gpu_util ?? 0) / 100) * 10,
      speed: 55,
    },
    {
      label: "Network",
      value: 45,
      color: "#2dd4bf",
      orbitRadius: 40,
      size: 10,
      speed: -65,
    },
  ], [telemetry]);

  return (
    <div className="glass-panel p-5 flex flex-col items-center gap-3">
      <div className="flex items-center gap-2 self-start text-teal-mystic">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="12" r="8" opacity="0.4" strokeDasharray="2 2" />
          <circle cx="12" cy="12" r="11" opacity="0.2" strokeDasharray="1 3" />
        </svg>
        <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">System Orbit</span>
      </div>
      <svg viewBox="0 0 200 200" className="w-full max-w-[200px] h-auto">
        {/* Orbital rings */}
        {bodies.map((body, i) => (
          <circle
            key={`orbit-${i}`}
            cx={CX}
            cy={CY}
            r={body.orbitRadius}
            fill="none"
            stroke="rgba(45,212,191,0.04)"
            strokeWidth="0.4"
          />
        ))}

        {/* Central core */}
        <circle cx={CX} cy={CY} r={8} fill="#0c1124" stroke="rgba(45,212,191,0.15)" strokeWidth="0.5" />
        <motion.circle
          cx={CX} cy={CY} r={4}
          fill="rgba(45,212,191,0.3)"
          animate={mounted ? { opacity: [0.2, 0.5, 0.2] } : {}}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Orbiting bodies */}
        {bodies.map((body, i) => {
          const cx = CX + body.orbitRadius;
          const cy = CY;
          return (
            <motion.g
              key={`body-${i}`}
              style={{ originX: CX, originY: CY }}
              animate={mounted ? { rotate: 360 } : { rotate: 0 }}
              transition={{ duration: body.speed, repeat: Infinity, ease: "linear", delay: i * 3 }}
            >
              <g>
                {/* Body aura */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={body.size + 4}
                  fill={`${body.color}15`}
                />
                {/* Body core */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={body.size}
                  fill="#0c1124"
                  stroke={body.color}
                  strokeWidth="1.5"
                />
                {/* Body inner */}
                <motion.circle
                  cx={cx}
                  cy={cy}
                  r={body.size * 0.4}
                  fill={body.color}
                  animate={mounted ? { opacity: [0.4, 0.8, 0.4] } : {}}
                  transition={{ duration: 2 + i, repeat: Infinity, ease: "easeInOut" }}
                />
                {/* Label — below orbit, static */}
                <text
                  x={cx}
                  y={cy + body.size + 12}
                  textAnchor="middle"
                  fill="rgba(161,161,170,0.6)"
                  fontSize="7"
                  fontFamily="monospace"
                >
                  {body.label} {body.value.toFixed(0)}%
                </text>
              </g>
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
}
