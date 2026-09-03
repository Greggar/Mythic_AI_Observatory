"use client";

import { useEffect, useMemo, useState } from "react";

interface Props {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  active: boolean;
  index: number;
  influence?: number;
}

export default function EnergyPath({ x1, y1, x2, y2, active, index, influence = 0 }: Props) {
  const [, setMounted] = useState(false);
  const [burst, setBurst] = useState(false);
  const [fading, setFading] = useState(false);
  const isActive = active || fading;
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (active) {
      setBurst(true);
      const t = setTimeout(() => setBurst(false), 1200);
      setFading(false);
      return () => clearTimeout(t);
    } else if (!fading) {
      setFading(true);
    }
  }, [active]);

  useEffect(() => {
    if (!fading) return;
    const t = setTimeout(() => setFading(false), 20000);
    return () => clearTimeout(t);
  }, [fading]);

  const { mx, my, cpx, cpy, revCpx, revCpy } = useMemo(() => {
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dX = x2 - x1;
    const dY = y2 - y1;
    return {
      mx: midX, my: midY,
      cpx: midX + dY * 0.12,
      cpy: midY - dX * 0.12,
      revCpx: midX - dY * 0.12,
      revCpy: midY + dX * 0.12,
    };
  }, [x1, x2, y1, y2]);

  const pathD = `M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`;
  const reversePathD = `M ${x2} ${y2} Q ${revCpx} ${revCpy} ${x1} ${y1}`;

  const inf = Math.min(Math.max(influence, 0), 1);
  const strokeW = isActive ? 1 + inf * 1.5 : 0.5 + inf * 0.5;
  const fadeRatio = fading ? 0.3 : 1;

  return (
    <g>
      <defs>
        <linearGradient id={`energy-${index}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(45,212,191,0.02)" />
          <stop offset="50%" stopColor={isActive ? `rgba(45,212,191,${(0.15 + inf * 0.3) * fadeRatio})` : "rgba(45,212,191,0.06)"} />
          <stop offset="100%" stopColor="rgba(45,212,191,0.02)" />
        </linearGradient>
      </defs>

      {/* Base luminous curve */}
      <path d={pathD} fill="none" stroke={`url(#energy-${index})`} strokeWidth={strokeW}
        opacity={isActive ? fadeRatio : 0.4}
        style={isActive ? { filter: `drop-shadow(0 0 ${4 + inf * 4}px rgba(45,212,191,${(0.1 + inf * 0.2) * fadeRatio}))` } : undefined}
        className={fading ? "transition-all duration-[20000ms] ease-linear" : ""}
      />

      {/* Forward flow — traveling dashes */}
      <path d={pathD} fill="none"
        stroke={isActive ? "#2dd4bf" : "rgba(45,212,191,0.04)"}
        strokeWidth={isActive ? 0.8 + inf * 0.8 : 0.3}
        strokeDasharray={active ? "3 10" : "2 15"}
        opacity={isActive ? (0.7 + inf * 0.3) * fadeRatio : 0.2}
        className={fading ? "transition-all duration-[20000ms] ease-linear" : ""}
      >
        {active && (
          <animate attributeName="stroke-dashoffset" from="0" to="-26" dur="2s" repeatCount="indefinite" begin={`${index * 0.2}s`} />
        )}
      </path>

      {/* Reverse flow — energy exchange */}
      {active && (
        <path d={reversePathD} fill="none"
          stroke="rgba(45,212,191,0.15)"
          strokeWidth={0.4 + inf * 0.4}
          strokeDasharray="2 12"
          opacity={0.3}
        >
          <animate attributeName="stroke-dashoffset" from="0" to="-28" dur="3s" repeatCount="indefinite" begin={`${1 + index * 0.2}s`} />
        </path>
      )}

      {/* Travelling particles — forward (animateMotion) */}
      {active && Array.from({ length: 3 + Math.floor(inf * 4) }).map((_, i) => (
        <circle key={`fp-${index}-${i}`} r={1 + inf * 0.5} fill="#2dd4bf">
          <animateMotion path={pathD} dur="1.5s" begin={`${i * 0.25 + index * 0.08}s`} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.7;0" dur="1.5s" begin={`${i * 0.25 + index * 0.08}s`} repeatCount="indefinite"
            calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
        </circle>
      ))}

      {/* Travelling particles — reverse (energy exchange) */}
      {active && Array.from({ length: Math.max(Math.floor(3 + Math.floor(inf * 4)) - 1, 1) }).map((_, i) => (
        <circle key={`rp-${index}-${i}`} r={0.8} fill="#f59e0b">
          <animateMotion path={reversePathD} dur="2s" begin={`${i * 0.3 + 0.5 + index * 0.08}s`} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.4;0" dur="2s" begin={`${i * 0.3 + 0.5 + index * 0.08}s`} repeatCount="indefinite"
            calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
        </circle>
      ))}

      {/* Solar flare burst on activation — one-shot */}
      {burst && (
        <>
          <circle cx={mx} cy={my} r={2} fill="#fbbf24"
            style={{ filter: "drop-shadow(0 0 6px rgba(251,191,36,0.4))" }}
          >
            <animate attributeName="opacity" values="0.6;0" dur="1.2s" fill="freeze" />
            <animate attributeName="r" values="2;16" dur="1.2s" fill="freeze" />
          </circle>
          <circle cx={mx} cy={my} r={1} fill="#fbbf24"
            style={{ filter: "drop-shadow(0 0 4px rgba(251,191,36,0.2))" }}
          >
            <animate attributeName="opacity" values="0.4;0" dur="1.8s" begin="0.3s" fill="freeze" />
            <animate attributeName="r" values="1;12" dur="1.8s" begin="0.3s" fill="freeze" />
          </circle>
        </>
      )}

      {/* Active glow highlight */}
      {active && (
        <path d={pathD} fill="none" stroke="#2dd4bf"
          strokeWidth={1.5 + inf * 1.5}
          strokeDasharray="2 25"
          style={{ filter: `drop-shadow(0 0 ${6 + inf * 6}px rgba(45,212,191,${0.15 + inf * 0.2}))` }}
        >
          <animate attributeName="opacity" values="0;0.15;0" dur="2.5s" begin={`${index * 0.15}s`} repeatCount="indefinite"
            calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
        </path>
      )}

      {/* Maritime semaphore signal flags */}
      {active && influence >= 0.5 && [0.3, 0.5, 0.7].map((t, i) => {
        const px = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cpx + t * t * x2;
        const py = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cpy + t * t * y2;
        const size = 6;
        const flagColor = i % 2 === 0 ? "#fbbf24" : "#2dd4bf";
        return (
          <rect key={`flag-${i}`}
            x={px - size / 2} y={py - size / 2}
            width={size} height={size}
            fill="none" stroke={flagColor} strokeWidth="0.5"
            style={{
              transform: `rotate(45deg)`,
              transformOrigin: `${px}px ${py}px`,
            }}
          >
            <animate attributeName="opacity" values="0.1;0.4;0.1" dur={`${2 + i * 0.4}s`} begin={`${i * 0.5}s`} repeatCount="indefinite"
              calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
          </rect>
        );
      })}

      {/* Traveling signal light — golden pulse (animateMotion) */}
      {active && influence >= 0.3 && Array.from({ length: 3 }).map((_, i) => (
        <circle key={`signal-${i}`} r={1.5} fill="#fbbf24"
          style={{ filter: "drop-shadow(0 0 3px rgba(251,191,36,0.4))" }}
        >
          <animateMotion path={pathD} dur="2.5s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.7;0" dur="2.5s" begin={`${i * 0.4}s`} repeatCount="indefinite"
            calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" />
        </circle>
      ))}
    </g>
  );
}
