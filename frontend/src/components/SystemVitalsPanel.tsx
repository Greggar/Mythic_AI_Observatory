"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

interface Vital {
  id: string;
  label: string;
  value: string;
  status: "green" | "yellow" | "red" | "unavailable";
  spark: number[];
}

interface Machine {
  id: string;
  name: string;
  desc: string;
  insight: string;
  status: "healthy" | "warning" | "critical" | "unavailable";
  vitals: Vital[];
}

interface VitalsData {
  machines: Machine[];
}

type DrillView =
  | { kind: "machine"; machineId: string }
  | { kind: "vital"; machineId: string; vitalId: string }
  | null;

const STATUS_COLORS: Record<string, { dot: string; badge: string; text: string }> = {
  healthy:  { dot: "bg-[oklch(62%_0.16_145)] shadow-[0_0_4px_oklch(62%_0.16_145)]",
              badge: "bg-[oklch(62%_0.16_145/0.12)] text-[oklch(62%_0.16_145)] border-[oklch(62%_0.16_145/0.2)]",
              text: "Operational" },
  warning:  { dot: "bg-[oklch(78%_0.14_85)] shadow-[0_0_4px_oklch(78%_0.14_85)]",
              badge: "bg-[oklch(78%_0.14_85/0.12)] text-[oklch(78%_0.14_85)] border-[oklch(78%_0.14_85/0.2)]",
              text: "Degraded" },
  critical: { dot: "bg-[oklch(55%_0.22_30)] shadow-[0_0_4px_oklch(55%_0.22_30)]",
              badge: "bg-[oklch(55%_0.22_30/0.12)] text-[oklch(55%_0.22_30)] border-[oklch(55%_0.22_30/0.2)]",
              text: "Critical" },
  unavailable: { dot: "bg-[oklch(72%_0.14_75)] shadow-[0_0_4px_oklch(72%_0.14_75)]",
                 badge: "bg-[oklch(72%_0.14_75/0.12)] text-[oklch(72%_0.14_75)] border-[oklch(72%_0.14_75/0.2)]",
                 text: "Unavailable" },
};

const VITAL_COLORS: Record<string, string> = {
  green:  "oklch(62% 0.16 145)",
  yellow: "oklch(78% 0.14 85)",
  red:    "oklch(55% 0.22 30)",
  unavailable: "oklch(72% 0.14 75)",
};

function CornerOrnament({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 28 28" fill="none" className={`absolute w-7 h-7 pointer-events-none text-[oklch(72%_0.11_75)] opacity-40 ${className}`}>
      <circle cx="14" cy="14" r="10" stroke="currentColor" strokeWidth="0.6" opacity="0.4" />
      <circle cx="14" cy="14" r="7" stroke="currentColor" strokeWidth="0.5" opacity="0.3" />
      <circle cx="14" cy="14" r="4" stroke="currentColor" strokeWidth="0.4" opacity="0.2" />
      <path d="M14 0 v10 M14 18 v10 M0 14 h10 M18 14 h10" stroke="currentColor" strokeWidth="0.4" opacity="0.25" />
    </svg>
  );
}

function CelestialOrb({ status }: { status: string }) {
  const clr = VITAL_COLORS[status] || "oklch(52% 0.03 265)";
  const opacity = status === "red" ? "0.85" : status === "unavailable" ? "0.75" : status === "yellow" ? "0.7" : "0.6";
  const pulseDur = status === "red" ? "1s" : status === "unavailable" ? "1.5s" : status === "yellow" ? "2s" : "2.5s";
  return (
    <span className="relative inline-flex shrink-0 w-4 h-4">
      <span
        className="absolute inset-[-3px] rounded-full opacity-0"
        style={{
          background: `radial-gradient(circle, ${clr}55 0%, transparent 70%)`,
          animation: `orbPulse ${pulseDur} ease-in-out infinite`,
        }}
      />
      <svg viewBox="0 0 16 16" fill="none" className="w-full h-full">
        <circle cx="8" cy="8" r="7" stroke={clr} strokeWidth="0.5" opacity="0.25" />
        <circle cx="8" cy="8" r="5" stroke={clr} strokeWidth="0.6" opacity="0.4" />
        <circle cx="8" cy="8" r="3" fill={clr} opacity={opacity} />
      </svg>
    </span>
  );
}

function Sparkline({ data, width = 160, height = 32, color }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(max - min, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const lastPt = pts.split(" ").pop()?.split(",") || [];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block align-middle">
      <polyline points={pts} fill="none" stroke={color || "oklch(72% 0.11 75)"} strokeWidth="1" opacity="0.7" />
      {lastPt.length === 2 && (
        <circle cx={lastPt[0]} cy={lastPt[1]} r="2" fill={color || "oklch(72% 0.11 75)"} />
      )}
    </svg>
  );
}

function VitalItem({ vital, onDrill }: { vital: Vital; onDrill: () => void }) {
  return (
    <button
      onClick={onDrill}
      className="flex items-center gap-1.5 px-1.5 py-1 rounded-[2px] hover:bg-[oklch(50%_0.05_265/0.16)] transition-colors text-left relative group min-h-[22px]"
    >
      <CelestialOrb status={vital.status} />
      <span className="text-[9px] text-[oklch(52%_0.03_265)] uppercase tracking-[0.04em] font-medium leading-tight whitespace-nowrap">
        {vital.label}
      </span>
      <span
        className={`ml-auto font-mono text-[10px] font-semibold tracking-[0.02em] tabular-nums ${
          vital.status === "green" ? "text-[oklch(62%_0.16_145)]" :
          vital.status === "yellow" ? "text-[oklch(78%_0.14_85)]" :
          vital.status === "unavailable" ? "text-[oklch(72%_0.14_75)]" :
          "text-[oklch(55%_0.22_30)]"
        }`}
      >
        {vital.value}
      </span>
      <span className="absolute right-1 bottom-0 text-[8px] text-[oklch(72%_0.11_75/0.4)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none font-[system-ui]">
        ↗
      </span>
    </button>
  );
}

function MachineCard({ machine, onMachineClick, onVitalClick }: {
  machine: Machine;
  onMachineClick: () => void;
  onVitalClick: (vitalId: string) => void;
}) {
  const sc = STATUS_COLORS[machine.status];
  return (
    <div
      onClick={onMachineClick}
      className="bg-[oklch(18%_0.04_265/0.65)] border border-[oklch(32%_0.06_265/0.45)] rounded-[2px] px-3 py-2.5 mb-1.5 last:mb-0 cursor-pointer transition-all duration-200 hover:bg-[oklch(22%_0.04_265/0.75)] hover:border-[oklch(72%_0.11_75/0.35)] hover:shadow-[inset_0_0_16px_oklch(0%_0_0/0.25),0_0_10px_oklch(75%_0.12_75/0.25)]"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-[Georgia,serif] text-[13px] font-medium tracking-[0.04em] text-[oklch(92%_0.01_260)]">
          <span className={`inline-block w-[7px] h-[7px] rounded-full mr-1.5 align-middle ${sc.dot}`} />
          {machine.name}
        </span>
        <span className={`text-[9px] tracking-[0.1em] uppercase px-2 py-0.5 rounded-[10px] font-semibold border ${sc.badge}`}>
          {sc.text}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-y-0.5 gap-x-1.5">
        {machine.vitals.map((v) => (
          <VitalItem key={v.id} vital={v} onDrill={() => onVitalClick(v.id)} />
        ))}
      </div>
    </div>
  );
}

export default function SystemVitalsPanel() {
  const [data, setData] = useState<VitalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<DrillView>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/vitals`);
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    poll();
    const interval = setInterval(poll, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const activeMachine = drill ? data?.machines.find((m) => m.id === drill.machineId) ?? null : null;
  const activeVital = drill?.kind === "vital" && activeMachine
    ? activeMachine.vitals.find((v) => v.id === drill.vitalId) ?? null
    : null;

  const closeDrill = useCallback(() => setDrill(null), []);

  // Keyboard escape to close drill
  useEffect(() => {
    if (!drill) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closeDrill(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [drill, closeDrill]);

  return (
    <div className="relative bg-[oklch(14%_0.04_268)] border border-[oklch(58%_0.10_75/0.35)] rounded-[1.5rem] overflow-hidden shadow-[0_0_50px_oklch(0%_0_0/0.5),inset_0_0_60px_oklch(10%_0.03_270/0.5)]">

      <CornerOrnament className="top-0 left-0" />
      <CornerOrnament className="top-0 right-0 -scale-x-100" />
      <CornerOrnament className="bottom-0 left-0 -scale-y-100" />
      <CornerOrnament className="bottom-0 right-0 -scale-100" />

      {/* Header */}
      <div className="relative px-4 pt-4 pb-2 text-center border-b border-[oklch(58%_0.10_75/0.35)] z-[1]
                      after:content-[''] after:absolute after:bottom-[-1px] after:left-[20%] after:right-[20%] after:h-[1px]
                      after:bg-gradient-to-r after:from-transparent after:via-[oklch(72%_0.11_75)] after:to-transparent">
        <svg viewBox="0 0 20 20" fill="none" className="inline-block w-5 h-5 mb-0.5 text-[oklch(72%_0.11_75)]">
          <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
          <path d="M10 1 v5 M10 14 v5 M1 10 h5 M14 10 h5" stroke="currentColor" strokeWidth="0.7" opacity="0.4" />
          <path d="M4 4 l3 3 M13 13 l3 3 M4 16 l3 -3 M13 7 l3 -3" stroke="currentColor" strokeWidth="0.5" opacity="0.25" />
        </svg>
        <h1 className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
          System Vitals
        </h1>
        <div className="font-[Georgia,serif] text-[10px] italic text-[oklch(52%_0.03_265)] tracking-[0.12em] mt-0.5">
          AI observatory &mdash; machine health nexus
        </div>
      </div>

      {/* Body */}
      <div className="p-2.5 overflow-y-auto max-h-[55vh] [&::-webkit-scrollbar]:w-[2px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[oklch(58%_0.10_75/0.35)] [&::-webkit-scrollbar-thumb]:rounded-[1px]">
        {loading && !data ? (
          <div className="flex items-center justify-center py-8">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[oklch(72%_0.11_75)] animate-pulse" />
          </div>
        ) : data ? (
          data.machines.map((m) => (
            <MachineCard
              key={m.id}
              machine={m}
              onMachineClick={() => setDrill({ kind: "machine", machineId: m.id })}
              onVitalClick={(vitalId) => setDrill({ kind: "vital", machineId: m.id, vitalId })}
            />
          ))
        ) : (
          <div className="text-center py-8 text-[10px] text-[oklch(52%_0.03_265)] italic">
            No data available
          </div>
        )}
      </div>

      {/* Drill overlay */}
      <AnimatePresence>
        {drill && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-[oklch(10%_0.04_268/0.96)] backdrop-blur-sm z-10 p-4 overflow-y-auto"
          >
            <button
              onClick={closeDrill}
              className="absolute top-2 right-2 w-6 h-6 border border-[oklch(58%_0.10_75/0.35)] rounded-full bg-transparent text-[oklch(72%_0.11_75)] text-sm grid place-items-center cursor-pointer hover:bg-[oklch(18%_0.04_265/0.65)] transition-colors"
            >
              &times;
            </button>

            {activeVital ? (
              <div>
                <h2 className="font-[Georgia,serif] text-[16px] text-[oklch(72%_0.11_75)] mb-0.5 tracking-[0.02em]">
                  {activeMachine?.name} &middot; {activeVital.label}
                </h2>
                <div className="text-[10px] text-[oklch(52%_0.03_265)] italic mb-3">
                  {activeVital.value} &mdash;{" "}
                  {activeVital.status === "green" ? "Healthy" : activeVital.status === "yellow" ? "Warning" : activeVital.status === "unavailable" ? "Unavailable" : "Critical"}
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-[oklch(32%_0.06_265/0.45)]">
                  <span className="text-[11px] text-[oklch(52%_0.03_265)]">Current</span>
                  <span className={`font-mono text-[12px] tabular-nums ${
                    activeVital.status === "green" ? "text-[oklch(62%_0.16_145)]" :
                    activeVital.status === "yellow" ? "text-[oklch(78%_0.14_85)]" :
                    "text-[oklch(55%_0.22_30)]"
                  }`}>
                    {activeVital.value}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-[oklch(32%_0.06_265/0.45)]">
                  <span className="text-[11px] text-[oklch(52%_0.03_265)]">Status</span>
                  <span className={`font-mono text-[12px] tabular-nums ${
                    activeVital.status === "green" ? "text-[oklch(62%_0.16_145)]" :
                    activeVital.status === "yellow" ? "text-[oklch(78%_0.14_85)]" :
                    activeVital.status === "unavailable" ? "text-[oklch(72%_0.14_75)]" :
                    "text-[oklch(55%_0.22_30)]"

  }`}>
                    {activeVital.value}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-[oklch(32%_0.06_265/0.45)]">
                  <span className="text-[11px] text-[oklch(52%_0.03_265)]">Status</span>
                  <span className={`font-mono text-[12px] tabular-nums ${
                    activeVital.status === "green" ? "text-[oklch(62%_0.16_145)]" :
                    activeVital.status === "yellow" ? "text-[oklch(78%_0.14_85)]" :
                    activeVital.status === "unavailable" ? "text-[oklch(72%_0.14_75)]" :
                    "text-[oklch(55%_0.22_30)]"

  }`}>
                    {activeVital.status === "green" ? "Healthy" : activeVital.status === "yellow" ? "Warning" : activeVital.status === "unavailable" ? "Unavailable" : "Critical"}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-[oklch(32%_0.06_265/0.45)]">
                  <span className="text-[11px] text-[oklch(52%_0.03_265)]">History ({activeVital.spark.length} samples)</span>
                  <Sparkline data={activeVital.spark} color={VITAL_COLORS[activeVital.status]} />
                </div>
                <div className="mt-3 text-[10px] text-[oklch(58%_0.10_75/0.35)] italic text-center">
                  Polled from Prometheus every 1.5s
                </div>
              </div>
            ) : activeMachine ? (
              <div>
                <h2 className="font-[Georgia,serif] text-[16px] text-[oklch(72%_0.11_75)] mb-0.5 tracking-[0.02em]">
                  {activeMachine.name}
                </h2>
                <div className="text-[10px] text-[oklch(52%_0.03_265)] italic mb-3">
                  {activeMachine.desc}
                </div>
                <p className="text-[11px] text-[oklch(72%_0.11_75/0.7)] mb-3 leading-relaxed italic">
                  {activeMachine.insight}
                </p>
                <div className="flex justify-between items-center py-1.5 border-b border-[oklch(32%_0.06_265/0.45)]">
                  <span className="text-[11px] text-[oklch(52%_0.03_265)]">Health</span>
                  <span className="font-mono text-[12px] tabular-nums text-[oklch(62%_0.16_145)]">
                    {activeMachine.vitals.filter((v) => v.status === "green").length}/{activeMachine.vitals.length} nominal
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-[oklch(32%_0.06_265/0.45)]">
                  <span className="text-[11px] text-[oklch(52%_0.03_265)]">Warnings</span>
                  <span className="font-mono text-[12px] tabular-nums text-[oklch(78%_0.14_85)]">
                    {activeMachine.vitals.filter((v) => v.status === "yellow").length}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-[oklch(32%_0.06_265/0.45)]">
                  <span className="text-[11px] text-[oklch(52%_0.03_265)]">Critical</span>
                  <span className="font-mono text-[12px] tabular-nums text-[oklch(55%_0.22_30)]">
                    {activeMachine.vitals.filter((v) => v.status === "red").length}
                  </span>
                </div>
                <div className="mt-3 text-[10px] text-[oklch(58%_0.10_75/0.35)] italic text-center">
                  Select a specific vital to see trend data
                </div>
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
