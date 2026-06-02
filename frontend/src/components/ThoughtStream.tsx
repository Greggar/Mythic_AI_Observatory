"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

interface Props {
  size: number;
  cx: number;
  cy: number;
  activeStepIndex: number | null;
  phase: "idle" | "replaying" | "complete";
  stepOutputs: Record<number, string | undefined>;
}

function BranchingPathways({ cx, cy }: { cx: number; cy: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const branches = useMemo(() => {
    const b = [];
    for (let i = 0; i < 5; i++) {
      const angle = (i * 72 - 90) * (Math.PI / 180);
      const len = 30 + Math.random() * 40;
      b.push({ angle, len });
    }
    return b;
  }, []);

  return (
    <g>
      {branches.map((br, i) => {
        const endX = cx + br.len * Math.cos(br.angle);
        const endY = cy + br.len * Math.sin(br.angle);
        const midX = cx + (br.len * 0.6) * Math.cos(br.angle + 0.3);
        const midY = cy + (br.len * 0.6) * Math.sin(br.angle + 0.3);
        return (
          <motion.path
            key={`branch-${i}`}
            d={`M ${cx} ${cy} Q ${midX} ${midY} ${endX} ${endY}`}
            fill="none"
            stroke="rgba(45,212,191,0.15)"
            strokeWidth="0.8"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={mounted ? { pathLength: [0, 1], opacity: [0, 0.2] } : {}}
            transition={{ duration: 1.2, delay: i * 0.15, ease: "easeOut" }}
          />
        );
      })}
      {[0, 1, 2, 3, 4].map((i) => {
        const br = branches[i];
        const dotX = cx + (br.len * 0.7) * Math.cos(br.angle + 0.15);
        const dotY = cy + (br.len * 0.7) * Math.sin(br.angle + 0.15);
        return (
          <motion.circle
            key={`dot-${i}`}
            cx={dotX}
            cy={dotY}
            r={1.5}
            fill="#2dd4bf"
            initial={{ opacity: 0 }}
            animate={mounted ? { opacity: [0, 0.5, 0] } : {}}
            transition={{ duration: 2, repeat: Infinity, delay: i * 0.3, ease: "easeInOut" }}
          />
        );
      })}
    </g>
  );
}

function MemoryFragments({ cx, cy }: { cx: number; cy: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fragments = useMemo(() => {
    const f = [];
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * 2 * Math.PI;
      const dist = 20 + Math.random() * 50;
      const size = 2 + Math.random() * 4;
      f.push({ x: cx + dist * Math.cos(angle), y: cy + dist * Math.sin(angle), size });
    }
    return f;
  }, []);

  return (
    <g>
      {fragments.map((f, i) => (
        <motion.g key={`fragment-${i}`}>
          <motion.circle
            cx={f.x} cy={f.y} r={f.size}
            fill="none"
            stroke="rgba(45,212,191,0.12)"
            strokeWidth="0.5"
            initial={{ opacity: 0, scale: 0 }}
            animate={mounted ? { opacity: [0, 0.3, 0], scale: [0, 1, 0.5] } : {}}
            transition={{ duration: 2.5, delay: i * 0.2, ease: "easeOut" }}
          />
          <motion.line
            x1={f.x} y1={f.y} x2={cx} y2={cy}
            stroke="rgba(45,212,191,0.04)"
            strokeWidth="0.3"
            initial={{ opacity: 0 }}
            animate={mounted ? { opacity: [0, 0.15, 0] } : {}}
            transition={{ duration: 2, delay: i * 0.2 + 0.5, ease: "easeOut" }}
          />
        </motion.g>
      ))}
    </g>
  );
}

function WeavingPathways({ cx, cy }: { cx: number; cy: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const threads = useMemo(() => {
    const t = [];
    for (let i = 0; i < 4; i++) {
      const pts = [];
      for (let j = 0; j <= 10; j++) {
        const tVal = j / 10;
        const angle = i * Math.PI / 2 + tVal * Math.PI * 2;
        const r = 15 + tVal * 35;
        pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
      }
      t.push(pts);
    }
    return t;
  }, []);

  return (
    <g>
      {threads.map((pts, i) => {
        const d = pts.map((p, j) => `${j === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
        return (
          <motion.path
            key={`thread-${i}`}
            d={d}
            fill="none"
            stroke="rgba(45,212,191,0.1)"
            strokeWidth="0.6"
            initial={{ pathLength: 0 }}
            animate={mounted ? { pathLength: [0, 1] } : {}}
            transition={{ duration: 2.5, delay: i * 0.3, ease: "easeInOut" }}
          />
        );
      })}
    </g>
  );
}

function LuminousScript({ cx, cy }: { cx: number; cy: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const glyphs = useMemo(() => {
    const g = [];
    const chars = "✦✧❋❊✻✼✽✾✿❀❁❂❃❄❅❆❇❈❉❊❋";
    for (let i = 0; i < 12; i++) {
      const angle = (i * 30) * (Math.PI / 180);
      const r = 20 + Math.random() * 40;
      g.push({
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        char: chars[Math.floor(Math.random() * chars.length)],
        size: 5 + Math.random() * 8,
      });
    }
    return g;
  }, []);

  return (
    <g>
      {glyphs.map((g, i) => (
        <motion.text
          key={`glyph-${i}`}
          x={g.x}
          y={g.y}
          textAnchor="middle"
          dominantBaseline="central"
          fill="rgba(45,212,191,0.12)"
          fontSize={g.size}
          fontFamily="serif"
          initial={{ opacity: 0, y: g.y - 10 }}
          animate={mounted ? { opacity: [0, 0.3, 0], y: [g.y - 10, g.y, g.y + 5] } : {}}
          transition={{ duration: 3, delay: i * 0.2, ease: "easeOut" }}
        >
          {g.char}
        </motion.text>
      ))}
    </g>
  );
}

function KnotworkTightening({ cx, cy }: { cx: number; cy: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const layers = useMemo(() => {
    const l = [];
    for (let ring = 0; ring < 3; ring++) {
      const r = 18 + ring * 8;
      const segments = [];
      for (let i = 0; i < 8; i++) {
        const a1 = (i * 45 * Math.PI) / 180;
        const a2 = ((i * 45 + 20) * Math.PI) / 180;
        segments.push({
          x1: cx + r * Math.cos(a1),
          y1: cy + r * Math.sin(a1),
          x2: cx + r * Math.cos(a2),
          y2: cy + r * Math.sin(a2),
        });
      }
      l.push({ r, segments });
    }
    return l;
  }, []);

  return (
    <g>
      {layers.map((layer, i) => (
        <motion.g
          key={`knot-layer-${i}`}
          style={{ originX: cx, originY: cy }}
          animate={mounted ? { rotate: [0, 360 * (i % 2 === 0 ? 1 : -1)] } : {}}
          transition={{ duration: 20 + i * 5, repeat: Infinity, ease: "linear" }}
        >
          {layer.segments.map((seg, j) => (
            <motion.path
              key={`seg-${i}-${j}`}
              d={`M ${seg.x1.toFixed(2)} ${seg.y1.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${seg.x2.toFixed(2)} ${seg.y2.toFixed(2)}`}
              fill="none"
              stroke={`rgba(45,212,191,${0.04 + i * 0.03})`}
              strokeWidth={0.4 + i * 0.2}
            />
          ))}
        </motion.g>
      ))}
    </g>
  );
}

function SolarBloom({ cx, cy }: { cx: number; cy: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const petals = useMemo(() => {
    const p = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i * 45 * Math.PI) / 180;
      p.push({
        x: cx + 45 * Math.cos(angle),
        y: cy + 45 * Math.sin(angle),
        angle,
      });
    }
    return p;
  }, []);

  return (
    <g>
      {petals.map((p, i) => (
        <motion.g key={`petal-${i}`} style={{ originX: p.x, originY: p.y }}>
          <motion.ellipse
            cx={p.x}
            cy={p.y}
            rx={6}
            ry={20}
            fill="none"
            stroke="rgba(251,191,36,0.12)"
            strokeWidth="0.8"
            style={{ transform: `rotate(${i * 45}deg)`, transformOrigin: `${p.x}px ${p.y}px` }}
            animate={mounted ? {
              opacity: [0.05, 0.25, 0.05],
              scale: [0.8, 1.2, 0.8],
            } : {}}
            transition={{ duration: 3, delay: i * 0.15, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.g>
      ))}
      {/* Radiant rays */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
        const rad = (angle * Math.PI) / 180;
        return (
          <motion.line
            key={`ray-${angle}`}
            x1={cx + 50 * Math.cos(rad)}
            y1={cy + 50 * Math.sin(rad)}
            x2={cx + 75 * Math.cos(rad)}
            y2={cy + 75 * Math.sin(rad)}
            stroke="rgba(251,191,36,0.06)"
            strokeWidth="0.5"
            initial={{ opacity: 0 }}
            animate={mounted ? { opacity: [0, 0.15, 0] } : {}}
            transition={{ duration: 4, delay: 0.5, repeat: Infinity, ease: "easeInOut" }}
          />
        );
      })}
    </g>
  );
}

// Step index -> visualiser mapping
const STEP_VISUALISER: Record<number, React.FC<{ cx: number; cy: number }>> = {
  0: BranchingPathways,
  1: BranchingPathways,
  2: MemoryFragments,
  3: MemoryFragments,
  4: WeavingPathways,
  5: LuminousScript,
  6: KnotworkTightening,
};

export default function ThoughtStream({
  size,
  cx,
  cy,
  activeStepIndex,
  phase,
  stepOutputs,
}: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  if (phase === "complete") {
    return <SolarBloom cx={cx} cy={cy} />;
  }

  if (activeStepIndex === null || activeStepIndex < 0) return null;

  const Visualiser = STEP_VISUALISER[activeStepIndex];
  if (!Visualiser) return null;

  return <Visualiser cx={cx} cy={cy} />;
}
