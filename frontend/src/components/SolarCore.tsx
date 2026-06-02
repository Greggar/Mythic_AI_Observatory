"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

interface Props {
  size?: number;
  traceActive: boolean;
  traceStep: number | null;
  conductorState: string;
  observatoryMode?: boolean;
}

export default function SolarCore({
  size = 800,
  traceActive,
  traceStep,
  conductorState,
  observatoryMode = false,
}: Props) {
  const CX = size / 2;
  const CY = size / 2;
  const [mounted, setMounted] = useState(false);
  const [pulsePhase, setPulsePhase] = useState(0);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const interval = setInterval(() => {
      setPulsePhase((prev) => (prev + 1) % 8);
    }, 3500);
    return () => clearInterval(interval);
  }, [mounted]);

  const triggerPulse = traceStep === 0 || traceStep === 5;
  const isCompleting = traceStep === 6;
  const isProcessing = traceStep !== null && traceStep >= 0 && traceStep < 6;

  const stateColor = useMemo(() => {
    if (isCompleting) return "#fbbf24";
    if (isProcessing) return "#2dd4bf";
    switch (conductorState) {
      case "processing": return "#2dd4bf";
      case "heavy_load": return "#f59e0b";
      case "error": return "#ef4444";
      default: return "#34d399";
    }
  }, [conductorState, isCompleting, isProcessing]);

  const glowIntensity = isCompleting ? 0.6 : isProcessing ? 0.4 : 0.2;

  function triskelePath(r: number, offset = 0) {
    const pts: [number, number][] = [];
    const cx = CX, cy = CY;
    for (let i = 0; i < 3; i++) {
      const a = ((i * 120 + offset) * Math.PI) / 180;
      pts.push([
        cx + r * Math.cos(a),
        cy + r * Math.sin(a),
      ]);
    }
    let d = "";
    for (let i = 0; i < 3; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % 3];
      const [x3, y3] = pts[(i + 2) % 3];
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      if (i === 0) d += `M ${mx.toFixed(4)} ${my.toFixed(4)}`;
      d += ` Q ${x2.toFixed(4)} ${y2.toFixed(4)} ${((mx + x3) / 2).toFixed(4)} ${((my + y3) / 2).toFixed(4)}`;
    }
    d += " Z";
    return d;
  }

  return (
    <g>
      <defs>
        <radialGradient id="coreAura" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={stateColor} stopOpacity={glowIntensity + 0.15} />
          <stop offset="40%" stopColor={stateColor} stopOpacity={glowIntensity * 0.5} />
          <stop offset="100%" stopColor={stateColor} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={stateColor} stopOpacity={glowIntensity + 0.3} />
          <stop offset="50%" stopColor={stateColor} stopOpacity={glowIntensity * 0.2} />
          <stop offset="100%" stopColor={stateColor} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="volumetric" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="60%" stopColor={stateColor} stopOpacity="0.03" />
          <stop offset="100%" stopColor="transparent" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Volumetric light — subtle off-centre highlight */}
      <circle cx={CX - 15} cy={CY - 15} r={60}
        fill="url(#volumetric)"
        style={{ mixBlendMode: "screen", pointerEvents: "none" }}
      >
        <animate attributeName="cx" values={`${CX - 15};${CX - 10};${CX - 18};${CX - 15}`} dur="12s" repeatCount="indefinite"
          calcMode="spline" keyTimes="0;0.333;0.666;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1" />
        <animate attributeName="cy" values={`${CY - 15};${CY - 20};${CY - 12};${CY - 15}`} dur="12s" repeatCount="indefinite"
          calcMode="spline" keyTimes="0;0.333;0.666;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1" />
      </circle>

      {/* Breathing aura — outermost glow */}
      <circle cx={CX} cy={CY} r={120} fill="url(#coreAura)">
        <animate attributeName="opacity" values="0.25;0.55;0.25" dur="5s" repeatCount="indefinite"
          calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
        <animate attributeName="r" values="120;132;120" dur="5s" repeatCount="indefinite"
          calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
      </circle>

      {/* Mid aura ring */}
      <circle cx={CX} cy={CY} r={80} fill="url(#coreGlow)">
        <animate attributeName="opacity" values="0.3;0.65;0.3" dur="6s" begin="0.5s" repeatCount="indefinite"
          calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
        <animate attributeName="r" values="80;84.8;80" dur="6s" begin="0.5s" repeatCount="indefinite"
          calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
      </circle>

      {/* Trace-activated pulse ring */}
      {(triggerPulse || (pulsePhase === 0 && !isCompleting)) && (
        <motion.circle
          cx={CX} cy={CY} r={15}
          fill="none" stroke={stateColor} strokeWidth="1.5"
          initial={{ opacity: 0.7, scale: 1 }}
          animate={{ opacity: 0, scale: 5 }}
          transition={{ duration: 2, ease: "easeOut" }}
          style={{ originX: CX, originY: CY }}
        />
      )}

      {/* Outer ring 1 — thick, slow rotation */}
      <g>
        <circle cx={CX} cy={CY} r={46}
          fill="none" stroke="rgba(45,212,191,0.08)" strokeWidth="1.5" strokeDasharray="2 14"
        />
        <animateTransform attributeName="transform" type="rotate" from={`0 ${CX} ${CY}`} to={`360 ${CX} ${CY}`} dur="50s" repeatCount="indefinite" />
      </g>

      {/* Outer ring 2 — counter-rotating */}
      <g>
        <circle cx={CX} cy={CY} r={40}
          fill="none" stroke="rgba(45,212,191,0.06)" strokeWidth="0.8" strokeDasharray="1 20"
        />
        <animateTransform attributeName="transform" type="rotate" from={`0 ${CX} ${CY}`} to={`-360 ${CX} ${CY}`} dur="65s" repeatCount="indefinite" />
      </g>

      {/* Inner ring 3 — fast rotation */}
      <g>
        <circle cx={CX} cy={CY} r={32}
          fill="none" stroke="rgba(45,212,191,0.1)" strokeWidth="0.6" strokeDasharray="3 8"
        />
        <animateTransform attributeName="transform" type="rotate" from={`0 ${CX} ${CY}`} to={`360 ${CX} ${CY}`} dur="35s" repeatCount="indefinite" />
      </g>

      {/* Triskele knot — Celtic solar symbol */}
      <g>
        <path d={triskelePath(24, 0)} fill="none" stroke="rgba(45,212,191,0.08)" strokeWidth="0.7" />
        <animateTransform attributeName="transform" type="rotate" from={`0 ${CX} ${CY}`} to={`360 ${CX} ${CY}`} dur="80s" repeatCount="indefinite" />
      </g>

      {/* Triskele counter-rotation */}
      <g>
        <path d={triskelePath(18, 60)} fill="none" stroke="rgba(45,212,191,0.06)" strokeWidth="0.5" />
        <animateTransform attributeName="transform" type="rotate" from={`0 ${CX} ${CY}`} to={`-360 ${CX} ${CY}`} dur="100s" repeatCount="indefinite" />
      </g>

      {/* Core breathing ring */}
      <circle cx={CX} cy={CY} r={26} fill="none" stroke={stateColor} strokeWidth="1.5">
        <animate attributeName="opacity" values="0.2;0.65;0.2" dur="4.5s" repeatCount="indefinite"
          calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
        <animate attributeName="r" values="26;27.3;26" dur="4.5s" repeatCount="indefinite"
          calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
      </circle>

      {/* Core body — outer shell */}
      <circle cx={CX} cy={CY} r={16} fill="#0c1124" stroke={stateColor} strokeWidth="1.5" opacity={0.9} />

      {/* Core inner dot */}
      <motion.circle cx={CX} cy={CY} r={6} fill={stateColor}
        animate={mounted ? {
          opacity: traceActive ? [0.7, 1, 0.7] : [0.4, 0.8, 0.4],
          scale: traceActive ? [1, 1.5, 1] : [1, 1.15, 1],
        } : {}}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        style={{ originX: CX, originY: CY }}
      />

      {/* Rose window mandala — completion symbol */}
      {isCompleting && (
        <g opacity="0.3">
          <defs>
            <radialGradient id="roseGlow">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.3" />
              <stop offset="20%" stopColor="#fbbf24" stopOpacity="0.1" />
              <stop offset="40%" stopColor="#34d399" stopOpacity="0.05" />
              <stop offset="70%" stopColor="#2dd4bf" stopOpacity="0.03" />
              <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx={CX} cy={CY} r={80} fill="url(#roseGlow)" />
          {/* Outer ring */}
          <g>
            <circle cx={CX} cy={CY} r={80} fill="none" stroke="#fbbf24" strokeWidth="0.3" />
            <animateTransform attributeName="transform" type="rotate" from={`0 ${CX} ${CY}`} to={`360 ${CX} ${CY}`} dur="60s" repeatCount="indefinite" />
          </g>
          {/* Petal arcs */}
          <g fill="none" stroke="#2dd4bf" strokeWidth="0.4" opacity="0.25">
            {[0, 60, 120, 180, 240, 300].map((rot) => (
              <path key={`petal-${rot}`}
                d={`M ${CX} ${CY - 60} A 60 60 0 0 1 ${CX + 60 * Math.sin(60 * Math.PI / 180)} ${CY + 60 * Math.cos(60 * Math.PI / 180)} A 60 60 0 0 1 ${CX} ${CY - 60}Z`}
                transform={`rotate(${rot} ${CX} ${CY})`}
                stroke="#2dd4bf"
              />
            ))}
          </g>
          {/* Inner sanctum rings */}
          <circle cx={CX} cy={CY} r={30} fill="none" stroke="#fbbf24" strokeWidth="0.4" opacity="0.3" />
          <circle cx={CX} cy={CY} r={15} fill="none" stroke="#34d399" strokeWidth="0.5" opacity="0.2" />
          <g>
            <circle cx={CX} cy={CY} r={50} fill="none" stroke="#fbbf24" strokeWidth="0.2" opacity="0.15" strokeDasharray="2 4" />
            <animateTransform attributeName="transform" type="rotate" from={`30 ${CX} ${CY}`} to={`360 ${CX} ${CY}`} dur="40s" repeatCount="indefinite" />
          </g>
          {/* Completion shine */}
          <circle cx={CX} cy={CY} r={4} fill="#fbbf24" opacity="0.6">
            <animate attributeName="r" values="4;6;4" dur="6s" repeatCount="indefinite"
              calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
            <animate attributeName="opacity" values="0.6;0.9;0.6" dur="6s" repeatCount="indefinite"
              calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
          </circle>
          {/* Petal completion indicators */}
          <g>
            {[
              { cx: CX, cy: CY - 60, color: "#34d399" },
              { cx: CX, cy: CY + 60, color: "#34d399" },
              { cx: CX - 60, cy: CY, color: "#2dd4bf" },
              { cx: CX + 60, cy: CY, color: "#2dd4bf" },
              { cx: CX - 52, cy: CY - 30, color: "#fbbf24" },
              { cx: CX + 52, cy: CY + 30, color: "#fbbf24" },
              { cx: CX + 52, cy: CY - 30, color: "#2dd4bf" },
              { cx: CX - 52, cy: CY + 30, color: "#34d399" },
            ].map((dot, i) => (
              <circle key={`dot-${i}`} cx={dot.cx} cy={dot.cy} r={2.5} fill={dot.color}>
                <animate attributeName="opacity" values="0.4;1;0.4" dur={`${3 + i * 0.3}s`} begin={`${i * 0.2}s`} repeatCount="indefinite"
                  calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
              </circle>
            ))}
          </g>
        </g>
      )}
    </g>
  );
}
