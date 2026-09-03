"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity } from "lucide-react";
import { apiGet } from "@/lib/api";
import { usePoll } from "@/lib/usePoll";

interface Vital {
  id: string;
  label: string;
  value: string;
  status: string;
}

interface Machine {
  id: string;
  name: string;
  host?: string;
  desc: string;
  insight: string;
  status: "healthy" | "warning" | "critical" | "unavailable";
  vitals: Vital[];
}

interface VitalsData {
  machines: Machine[];
}

const STATUS_GLOW: Record<string, string> = {
  healthy: "#34d399",
  warning: "#f59e0b",
  critical: "#ef4444",
  unavailable: "#f59e0b",
};

function parsePct(value: string): number {
  const m = value.match(/^([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

function getVital(machine: Machine, id: string): Vital | undefined {
  return machine.vitals.find((v) => v.id === id);
}

interface ServiceDef {
  x: number;
  y: number;
  label: string;
  color: string;
  name: string;
  desc: string;
}

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
  const [services, setServices] = useState<Record<string, ServiceDef[]>>({});
  const [servicesKey, setServicesKey] = useState(0);
  const [planetAngles, setPlanetAngles] = useState<number[]>([]);

  const clearHover = useCallback(() => {
    hoverTimeout.current = setTimeout(() => setHovered(null), 150);
  }, []);

  const handleMouseEnter = useCallback((e: React.MouseEvent, label: string, target?: string) => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setHovered({ label, x: e.clientX, y: e.clientY, target });
  }, []);

  // Fetch vitals (polling)
  useEffect(() => {
    setMounted(true);
  }, []);

  usePoll<VitalsData>(() => apiGet<VitalsData>("/api/vitals"), 3000, {
    onResult: setData,
  });

  // Fetch services (manual trigger via servicesKey)
  useEffect(() => {
    apiGet<Record<string, ServiceDef[]>>("/api/services")
      .then(setServices)
      .catch(() => {});
  }, [servicesKey]);

  // The local machine (127.0.0.1) is the solar core; all others orbit (including the _logs sentinel)
  const sun = useMemo(() => data?.machines.find((m) => m.host === "127.0.0.1") ?? data?.machines[0] ?? null, [data]);
  const planets = useMemo(
    () => data?.machines.filter((m) => m.host !== "127.0.0.1") ?? [],
    [data]
  );

  // Initialize planet angles spread evenly around full circle
  useEffect(() => {
    setPlanetAngles(planets.map((_, i) => (360 / Math.max(planets.length, 1)) * i));
  }, [planets.length]);

  // Dynamically compute orbit radii spaced evenly across the available band
  // Avoids clipping labels when extra machines (e.g. Trace Logs) are added.
  const ORBIT_R_MIN = 180;
  const ORBIT_R_MAX = 440;
  const orbitRadii = useMemo(() => {
    const n = planets.length;
    if (n === 0) return [] as number[];
    if (n === 1) return [ORBIT_R_MIN + (ORBIT_R_MAX - ORBIT_R_MIN) / 2] as number[];
    return Array.from({ length: n }, (_, i) =>
      ORBIT_R_MIN + ((ORBIT_R_MAX - ORBIT_R_MIN) / (n - 1)) * i
    );
  }, [planets.length]);

  // Alternate direction per orbit so planets don't clump
  const orbitSpeeds = useMemo(
    () => planets.map((_, i) => [55, -40, 65, -50, 45, -60][i % 6]),
    [planets.length]
  );

  const animRef = useRef<number>(0);
  useEffect(() => {
    if (!mounted || planets.length === 0) return;
    let lastTick = performance.now();
    function tick(now: number) {
      const dt = (now - lastTick) / 1000;
      lastTick = now;
      setPlanetAngles((prev) =>
        prev.map((a, i) => {
          const speed = orbitSpeeds[i] ?? 50;
          const period = Math.abs(speed);
          const dir = speed > 0 ? 1 : -1;
          return a + (360 / period) * dir * dt;
        })
      );
      animRef.current = requestAnimationFrame(tick);
    }
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [mounted, planets.length]);

  return (
    <div className="glass-panel p-5 flex flex-col items-center gap-3" ref={containerRef}>
      <div className="flex items-center justify-between w-full">
        <div />
        <div className="flex flex-col items-center gap-1.5 text-teal-mystic">
          <Activity size={16} />
          <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
            System Orbit
          </span>
        </div>
        <button
          onClick={() => setServicesKey((n) => n + 1)}
          className="text-zinc-600 hover:text-teal-mystic transition-colors"
          title="Refresh services"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 4v6h6M23 20v-6h-6" />
            <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
          </svg>
        </button>
      </div>

      <svg viewBox="0 0 1000 1000" className="w-full max-w-[500px] h-auto">
        {/* Orbital rings */}
        {planets.map((_, i) => (
          <circle
            key={`orbit-${i}`}
            cx={CX}
            cy={CY}
            r={orbitRadii[i] ?? 70}
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
            {services[sun.name]?.map((s, i) => (
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

        {/* Orbiting planets + satellite */}
        {planets.map((machine, i) => {
          const isSentinel = machine.id === "_logs";
          const cpu = parsePct(getVital(machine, "cpu")?.value ?? "0");
          const mem = parsePct(getVital(machine, "mem")?.value ?? "0");
          const planetSize = isSentinel ? 14 : 20 + (mem / 100) * 46;
          const brightness = isSentinel ? 1 : 0.6 + (cpu / 100) * 0.35;
          const color = isSentinel ? "oklch(62% 0.22 195)" : STATUS_GLOW[machine.status];

          const orbitR = orbitRadii[i] ?? (120 + i * 60);
          const angleRad = ((planetAngles[i] ?? 0) * Math.PI) / 180;
          const px = CX + orbitR * Math.cos(angleRad);
          const py = CY + orbitR * Math.sin(angleRad);

          return (
            <g key={machine.id}>
              <g
                onMouseEnter={(e) => handleMouseEnter(e, isSentinel ? "OpenClaw Sentinel" : machine.name)}
                onMouseLeave={clearHover}
                style={{ cursor: "pointer" }}
              >
                {isSentinel ? (
                  <>
                    {/* Scan ring pulse */}
                    <motion.circle
                      cx={px} cy={py}
                      r={36}
                      fill="none"
                      stroke={color}
                      strokeWidth="1.5"
                      opacity="0.4"
                      animate={{ r: [28, 48, 28], opacity: [0.5, 0.1, 0.5] }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                    />
                    {/* Antenna dish */}
                    <line x1={px} y1={py - 12} x2={px} y2={py - 28}
                      stroke={color} strokeWidth="2" opacity="0.7" />
                    <line x1={px - 6} y1={py - 22} x2={px + 6} y2={py - 22}
                      stroke={color} strokeWidth="1.5" opacity="0.6" />
                    {/* Signal arcs */}
                    <motion.path
                      d={`M ${px - 8} ${py - 30} Q ${px} ${py - 44} ${px + 8} ${py - 30}`}
                      fill="none" stroke={color} strokeWidth="1.5" opacity="0.5"
                      animate={{ opacity: [0.3, 0.8, 0.3] }}
                      transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                    />
                    {/* Satellite body — hexagon */}
                    <polygon
                      points={
                        [0, -planetSize, planetSize * 0.87, -planetSize * 0.5,
                         planetSize * 0.87, planetSize * 0.5, 0, planetSize,
                         -planetSize * 0.87, planetSize * 0.5, -planetSize * 0.87, -planetSize * 0.5]
                          .map((v, j) => `${j % 2 === 0 ? px + v : py + v}`).join(" ")
                      }
                      fill="#0c1124" stroke={color} strokeWidth="2" opacity={brightness}
                    />
                    {/* Core glow */}
                    <motion.circle
                      cx={px} cy={py}
                      r={4}
                      fill={color}
                      opacity={0.9}
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                    />
                    {/* Satellite label */}
                    <text x={px} y={py + 36}
                      textAnchor="middle" fill={color}
                      fontSize="20" fontFamily="monospace" fontWeight="bold">
                      OPENCLAW SENTINEL
                    </text>
                    {/* Monitoring badge */}
                    <text x={px} y={py + 52}
                      textAnchor="middle" fill="oklch(62% 0.22 195 / 0.5)"
                      fontSize="15" fontFamily="monospace">
                      ● MONITORING
                    </text>
                  </>
                ) : (
                  <>
                    {/* Active workload halo */}
                    {cpu > 20 && (
                      <motion.circle
                        cx={px} cy={py}
                        r={planetSize + 20}
                        fill={color}
                        opacity="0.08"
                        animate={{ opacity: [0.05, 0.15, 0.05] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                      />
                    )}
                    {/* Planet body */}
                    <circle cx={px} cy={py} r={planetSize} fill="#0c1124" stroke={color} strokeWidth="3" opacity={brightness} />
                    {/* Planet core glow */}
                    <motion.circle
                      cx={px} cy={py}
                      r={planetSize * 0.4}
                      fill={color}
                      opacity={1}
                      animate={mounted ? { opacity: [0.5, brightness + 0.2, 0.5] } : {}}
                      transition={{ duration: 2 + i, repeat: Infinity, ease: "easeInOut" }}
                    />
                    {/* Planet label */}
                    <text x={px} y={py + planetSize + 46}
                      textAnchor="middle" fill="oklch(72% 0.11 75 / 0.7)"
                      fontSize="26" fontFamily="monospace" fontWeight="bold">
                      {machine.name.toUpperCase()}
                    </text>
                    {/* CPU/RAM stats under label */}
                    <text x={px} y={py + planetSize + 70}
                      textAnchor="middle" fill="oklch(52% 0.03 265 / 0.5)"
                      fontSize="18" fontFamily="monospace">
                      CPU {cpu.toFixed(0)}% · RAM {mem.toFixed(0)}%
                    </text>
                  </>
                )}
                {/* Service glyphs around planet (not for sentinel) */}
                {!isSentinel && services[machine.name]?.map((s, j) => (
                  <g key={j}
                    onMouseEnter={(e) => handleMouseEnter(e, s.label, machine.name)}
                    onMouseLeave={clearHover}
                    style={{ cursor: "pointer" }}
                  >
                    {active ? (
                      <motion.circle
                        cx={px + s.x * 3.3} cy={py + s.y * 3.3}
                        r={4} fill={s.color}
                        animate={{ opacity: [0.4, 1, 0.4], r: [4, 6, 4] }}
                        transition={{ duration: 2.5, delay: j * 0.3, repeat: Infinity, ease: "easeInOut" }}
                      />
                    ) : (
                      <circle cx={px + s.x * 3.3} cy={py + s.y * 3.3} r={4} fill={s.color} opacity="0.7" />
                    )}
                    <text x={px + s.x * 3.3} y={py + s.y * 3.3 - 9}
                      textAnchor="middle" fill="oklch(52% 0.03 265 / 0.5)"
                      fontSize="8" fontFamily="monospace">
                      {s.label}
                    </text>
                  </g>
                ))}
              </g>
            </g>
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

      {/* Tooltip — portaled to document.body so it never clips */}
      {hovered && (() => {
        const info = Object.values(services).flat().find((s) => s.label === hovered.label);
        return createPortal(
          <div
            className="fixed z-[100] pointer-events-none"
            style={{ left: hovered.x + 14, top: hovered.y - 10 }}
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
          </div>,
          document.body
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
