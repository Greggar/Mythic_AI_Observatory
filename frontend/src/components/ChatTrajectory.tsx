"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { TraceSession } from "@/types/trace";

interface Props {
  exchanges: TraceSession[];
  onSelectExchange: (traceId: string) => void;
}

interface TrajPoint {
  id: string;
  ex: number;
  mean: number;
  p95: number;
  hi: number;
  tokens: number;
  intent: string;
  confidence: number | null;
  model: string | null;
  prompt: string;
  time: string;
}

const INTENT_COLORS = [
  "#2dd4bf", "#a78bfa", "#fbbf24", "#60a5fa",
  "#f472b6", "#fb923c", "#34d399", "#c084fc",
];

const W = 720;
const H = 190;
const PAD = { l: 36, r: 14, t: 16, b: 26 };

function extractIntent(t: TraceSession): string {
  const step = t.steps?.find((s) => s.label === "Intent Classification");
  const probs = step?.metadata?.intent_probs;
  if (Array.isArray(probs) && probs.length > 0 && probs[0]) {
    return String((probs[0] as { label?: string }).label ?? "");
  }
  return "";
}

export default function ChatTrajectory({ exchanges, onSelectExchange }: Props) {
  const [hover, setHover] = useState<{ x: number; y: number; pt: TrajPoint } | null>(null);

  const { points, intentColor } = useMemo(() => {
    const sorted = [...exchanges]
      .filter((t) => t.status === "complete" && t.token_entropy?.mean_entropy != null)
      .sort((a, b) => (a.exchange_index ?? 0) - (b.exchange_index ?? 0));

    const colorOf = new Map<string, string>();
    let next = 0;
    const pts: TrajPoint[] = sorted.map((t) => {
      const e = t.token_entropy!;
      const intent = extractIntent(t);
      if (!colorOf.has(intent)) colorOf.set(intent, INTENT_COLORS[next++ % INTENT_COLORS.length]);
      return {
        id: t.id,
        ex: t.exchange_index ?? 0,
        mean: e.mean_entropy ?? 0,
        p95: e.p95_entropy ?? (e.mean_entropy ?? 0),
        hi: e.high_entropy_count ?? 0,
        tokens: e.token_count ?? 0,
        intent,
        confidence: t.confidence,
        model: t.model_used,
        prompt: t.prompt,
        time: t.created_at?.slice(11, 19) ?? "",
      };
    });
    return { points: pts, intentColor: colorOf };
  }, [exchanges]);

  if (points.length === 0) return null;

  const maxY = Math.max(...points.map((p) => Math.max(p.mean, p.p95)), 0.25) * 1.15;
  const n = points.length;
  const x = (i: number) => PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - v / maxY) * (H - PAD.t - PAD.b);

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.mean).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const p95Path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.p95).toFixed(1)}`).join(" ");

  const peak = points.reduce((a, b) => (b.mean > a.mean ? b : a), points[0]);
  const delta = points[points.length - 1].mean - points[0].mean;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="glass-panel p-4"
    >
      <div className="flex items-center justify-between px-0.5 mb-2">
        <span className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">
          Session Trajectory
        </span>
        <div className="flex items-center gap-3 text-[9px] font-mono">
          <span className="text-zinc-500">
            peak H{" "}
            <span className="text-solar-gold">
              {peak.mean.toFixed(3)}
            </span>{" "}
            <span className="text-zinc-600">EX{peak.ex}</span>
          </span>
          <span className="text-zinc-500">
            ΔH{" "}
            <span className={delta <= 0 ? "text-teal-mystic" : "text-red-400"}>
              {delta >= 0 ? "+" : ""}
              {delta.toFixed(3)}
            </span>
          </span>
          <span className="text-zinc-500">
            {points.reduce((s, p) => s + p.tokens, 0)} tokens
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Entropy trajectory across chat exchanges">
        <defs>
          <linearGradient id="traj-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y(maxY * f)}
            y2={y(maxY * f)}
            stroke="#ffffff"
            strokeOpacity={0.05}
            strokeWidth={1}
          />
        ))}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <text
            key={`t-${f}`}
            x={PAD.l - 6}
            y={y(maxY * f) + 3}
            textAnchor="end"
            fill="#71717a"
            fontSize={8}
            fontFamily="ui-monospace, monospace"
          >
            {(maxY * f).toFixed(2)}
          </text>
        ))}

        <path d={areaPath} fill="url(#traj-fill)" />
        <path d={p95Path} fill="none" stroke="#a78bfa" strokeOpacity={0.5} strokeWidth={1.2} strokeDasharray="3 3" />
        <path d={linePath} fill="none" stroke="#2dd4bf" strokeWidth={1.8} />

        {points.map((p, i) => (
          <g key={p.id}>
            <circle
              cx={x(i)}
              cy={y(p.p95)}
              r={2.2}
              fill="#a78bfa"
              fillOpacity={0.7}
              pointerEvents="none"
            />
            <circle
              cx={x(i)}
              cy={y(p.mean)}
              r={hover?.pt.id === p.id ? 6.5 : 4.5}
              fill={intentColor.get(p.intent) ?? "#2dd4bf"}
              stroke="#0a0a0a"
              strokeWidth={1.2}
              style={{ cursor: "pointer" }}
              onClick={() => onSelectExchange(p.id)}
              onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, pt: p })}
              onMouseMove={(e) => setHover((h) => (h?.pt.id === p.id ? { ...h, x: e.clientX, y: e.clientY } : h))}
              onMouseLeave={() => setHover((h) => (h?.pt.id === p.id ? null : h))}
            />
            <text
              x={x(i)}
              y={H - PAD.b + 14}
              textAnchor="middle"
              fill={hover?.pt.id === p.id ? "#e4e4e7" : "#52525b"}
              fontSize={8.5}
              fontFamily="ui-monospace, monospace"
              pointerEvents="none"
            >
              EX{p.ex}
            </text>
          </g>
        ))}
      </svg>

      {/* Intent strip */}
      <div className="flex items-center gap-1.5 flex-wrap mt-2 px-0.5">
        {points.map((p, i) => (
          <div key={`${p.id}-strip`} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-[9px] text-zinc-700">→</span>}
            <button
              onClick={() => onSelectExchange(p.id)}
              className={`flex items-center gap-1.5 text-[9px] font-mono px-2 py-1 rounded-full border transition-colors ${
                hover?.pt.id === p.id
                  ? "border-white/20 text-zinc-200"
                  : "border-white/[0.06] text-zinc-500 hover:text-zinc-300"
              }`}
              onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, pt: p })}
              onMouseLeave={() => setHover((h) => (h?.pt.id === p.id ? null : h))}
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: intentColor.get(p.intent) ?? "#2dd4bf" }}
              />
              EX{p.ex} · {p.intent || "—"}
            </button>
          </div>
        ))}
      </div>

      {hover && typeof document !== "undefined" && (
        createPortal(
          <div
            className="fixed z-[100] pointer-events-none glass-panel p-3 w-72 space-y-1.5"
            style={{ left: Math.min(hover.x + 14, window.innerWidth - 300), top: Math.min(hover.y + 14, window.innerHeight - 220) }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-teal-mystic">EX{hover.pt.ex}</span>
              <span className="text-[9px] font-mono text-zinc-600">{hover.pt.time}</span>
            </div>
            <div className="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap line-clamp-2">
              {hover.pt.prompt}
            </div>
            <div className="flex items-center gap-1.5 pt-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: intentColor.get(hover.pt.intent) ?? "#2dd4bf" }} />
              <span className="text-[10px] font-mono text-zinc-200">
                {hover.pt.intent || "unclassified"}
                {hover.pt.confidence != null && (
                  <span className="text-zinc-500"> · {Math.round(hover.pt.confidence * 100)}%</span>
                )}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 text-[10px] font-mono">
              <span className="text-zinc-500">mean H</span>
              <span className="text-teal-mystic text-right">{hover.pt.mean.toFixed(3)}</span>
              <span className="text-zinc-500">p95 H</span>
              <span className="text-violet-300 text-right">{hover.pt.p95.toFixed(3)}</span>
              <span className="text-zinc-500">high-entropy</span>
              <span className="text-solar-gold text-right">
                {hover.pt.hi}/{hover.pt.tokens}
                {hover.pt.tokens > 0 && (
                  <span className="text-zinc-600"> ({Math.round((hover.pt.hi / hover.pt.tokens) * 100)}%)</span>
                )}
              </span>
              <span className="text-zinc-500">model</span>
              <span className="text-zinc-300 text-right truncate">{hover.pt.model ?? "—"}</span>
            </div>
          </div>,
          document.body
        )
      )}
    </motion.div>
  );
}
