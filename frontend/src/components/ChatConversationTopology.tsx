"use client";

import { motion, useAnimationFrame, useMotionValue, useTransform } from "framer-motion";
import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { mds2d, cosineSimilarity, pairwiseDistances } from "@/utils/mds";
import type { TraceSession } from "@/types/trace";

interface Props {
  exchanges: TraceSession[];
  onSelectExchange: (traceId: string) => void;
  playing?: boolean;
  current?: number | null;
}

interface TopoPoint {
  id: string;
  ex: number;
  x: number;
  y: number;
  tokens: number;
  entropy: number;
  intent: string;
  confidence: number | null;
  model: string | null;
  prompt: string;
  time: string;
  embedding: number[];
}

const INTENT_COLORS = [
  "#2dd4bf", "#a78bfa", "#fbbf24", "#60a5fa",
  "#f472b6", "#fb923c", "#34d399", "#c084fc",
];

const W = 720;
const H = 240;
const LOOP_MS = 14000;

function extractIntent(t: TraceSession): string {
  const step = t.steps?.find((s) => s.label === "Intent Classification");
  const probs = step?.metadata?.intent_probs;
  if (Array.isArray(probs) && probs.length > 0 && probs[0]) {
    return String((probs[0] as { label?: string }).label ?? "");
  }
  return "";
}

function driftColor(d: number): string {
  if (d < 0.3) return "#2dd4bf";
  if (d < 0.6) return "#fbbf24";
  return "#f472b6";
}

export default function ChatConversationTopology({
  exchanges,
  onSelectExchange,
  playing = false,
  current = null,
}: Props) {
  const [hover, setHover] = useState<{ x: number; y: number; pt: TopoPoint } | null>(null);
  const progress = useMotionValue(0);

  const { pts, intentColor, cumLen, totalLen, nodeT, pathD } = useMemo(() => {
    const sorted = [...exchanges]
      .filter((t) => t.status === "complete" && Array.isArray(t.embedding) && t.embedding!.length > 0)
      .sort((a, b) => (a.exchange_index ?? 0) - (b.exchange_index ?? 0));

    const colorOf = new Map<string, string>();
    let next = 0;
    const raw = sorted.map((t) => {
      const intent = extractIntent(t);
      if (!colorOf.has(intent)) colorOf.set(intent, INTENT_COLORS[next++ % INTENT_COLORS.length]);
      return {
        id: t.id,
        ex: t.exchange_index ?? 0,
        tokens: t.token_entropy?.token_count ?? 0,
        entropy: t.token_entropy?.mean_entropy ?? 0,
        intent,
        confidence: t.confidence,
        model: t.model_used,
        prompt: t.prompt,
        time: t.created_at?.slice(11, 19) ?? "",
        embedding: t.embedding!,
      };
    });

    if (raw.length === 0) {
      return { pts: [], intentColor: colorOf, cumLen: [], totalLen: 0, nodeT: [], pathD: "" };
    }

    const dist = pairwiseDistances(raw.map((r) => r.embedding));
    const pos = mds2d(dist, W, H);
    const pts: TopoPoint[] = raw.map((r, i) => ({
      ...r,
      x: pos[i].x,
      y: pos[i].y,
    }));

    const cLens: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      cLens.push(cLens[i - 1] + Math.hypot(dx, dy));
    }
    const total = cLens[cLens.length - 1] || 1;

    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

    return {
      pts,
      intentColor: colorOf,
      cumLen: cLens,
      totalLen: total,
      nodeT: cLens.map((c) => c / total),
      pathD: d,
    };
  }, [exchanges]);

  useEffect(() => {
    if (playing && current != null && current < pts.length) {
      const target = nodeT[current];
      const from = progress.get();
      const start = performance.now();
      const dur = 600;
      let raf = 0;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / dur);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        progress.set(from + (target - from) * eased);
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
  }, [playing, current, pts.length, nodeT, progress]);

  useAnimationFrame((_, delta) => {
    if (playing) return;
    if (pts.length < 2) return;
    progress.set((progress.get() + delta / LOOP_MS) % 1);
  });

  const px = useTransform(progress, (t) => {
    if (pts.length === 0) return 0;
    if (pts.length === 1) return pts[0].x;
    const pos = t * totalLen;
    let i = 0;
    while (i < cumLen.length - 1 && cumLen[i + 1] < pos) i++;
    const seg = cumLen[i + 1] - cumLen[i] || 1;
    const f = Math.max(0, Math.min(1, (pos - cumLen[i]) / seg));
    return pts[i].x + (pts[i + 1].x - pts[i].x) * f;
  });
  const py = useTransform(progress, (t) => {
    if (pts.length === 0) return 0;
    if (pts.length === 1) return pts[0].y;
    const pos = t * totalLen;
    let i = 0;
    while (i < cumLen.length - 1 && cumLen[i + 1] < pos) i++;
    const seg = cumLen[i + 1] - cumLen[i] || 1;
    const f = Math.max(0, Math.min(1, (pos - cumLen[i]) / seg));
    return pts[i].y + (pts[i + 1].y - pts[i].y) * f;
  });

  if (pts.length === 0) return null;

  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const span = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)), 60);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const net = Math.hypot(last.x - first.x, last.y - first.y);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="glass-panel p-4"
    >
      <div className="flex items-center justify-between px-0.5 mb-2">
        <span className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">
          Conversation Topology
        </span>
        <div className="flex items-center gap-3 text-[9px] font-mono">
          <span className="text-zinc-500">
            {pts.length} embedded exchanges
          </span>
          <span className="text-zinc-500">
            displacement{" "}
            <span className={net > span * 0.8 ? "text-violet-300" : "text-teal-mystic"}>
              {net.toFixed(0)}
            </span>
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Conversation topology in embedding topic space">
        <defs>
          <linearGradient id="topo-comet" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.9" />
          </linearGradient>
        </defs>

        {/* Landscape rings */}
        {[1, 2, 3, 4].map((r) => (
          <circle
            key={r}
            cx={cx}
            cy={cy}
            r={(span * r) / 4}
            fill="none"
            stroke="#ffffff"
            strokeOpacity={0.05}
            strokeWidth={1}
            strokeDasharray={r === 4 ? undefined : "2 5"}
          />
        ))}

        {/* Terrain contour */}
        <path
          d={pathD}
          fill="none"
          stroke="#2dd4bf"
          strokeOpacity={0.12}
          strokeWidth={14}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={pathD}
          fill="none"
          stroke="#2dd4bf"
          strokeOpacity={0.4}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Hop drift labels */}
        {pts.length > 1 &&
          pts.slice(0, -1).map((p, i) => {
            const q = pts[i + 1];
            const d = 1 - cosineSimilarity(p.embedding, q.embedding);
            const mx = (p.x + q.x) / 2;
            const my = (p.y + q.y) / 2;
            return (
              <g key={`${p.id}-hop`} pointerEvents="none">
                <circle cx={mx} cy={my} r={9} fill="#0a0a0a" fillOpacity={0.85} />
                <text
                  x={mx}
                  y={my + 2.5}
                  textAnchor="middle"
                  fill={driftColor(d)}
                  fontSize={7.5}
                  fontFamily="ui-monospace, monospace"
                >
                  {d.toFixed(2)}
                </text>
              </g>
            );
          })}

        {/* Comet */}
        <motion.circle
          cx={px}
          cy={py}
          r={4}
          fill="url(#topo-comet)"
          stroke="#0a0a0a"
          strokeWidth={1.5}
          style={{ filter: "drop-shadow(0 0 6px rgba(45,212,191,0.8))" }}
          pointerEvents="none"
        />

        {/* Nodes */}
        {pts.map((p, i) => {
          const r = 3.5 + Math.min(6, Math.sqrt(p.tokens) * 0.32);
          const dim = hover?.pt.id === p.id ? false : playing && current != null && current !== i;
          return (
            <g key={p.id}>
              <circle
                cx={p.x}
                cy={p.y}
                r={r + 2}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, pt: p })}
                onMouseMove={(e) => setHover((h) => (h?.pt.id === p.id ? { ...h, x: e.clientX, y: e.clientY } : h))}
                onMouseLeave={() => setHover((h) => (h?.pt.id === p.id ? null : h))}
                onClick={() => onSelectExchange(p.id)}
              />
              <circle
                cx={p.x}
                cy={p.y}
                r={r + 2.5}
                fill="none"
                stroke={intentColor.get(p.intent) ?? "#2dd4bf"}
                strokeOpacity={hover?.pt.id === p.id ? 0.8 : 0.3}
                strokeWidth={hover?.pt.id === p.id ? 1.4 : 0.7}
              />
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill={intentColor.get(p.intent) ?? "#2dd4bf"}
                fillOpacity={dim ? 0.25 : 0.85}
                stroke="#0a0a0a"
                strokeWidth={1}
                style={{ cursor: "pointer" }}
                onClick={() => onSelectExchange(p.id)}
                onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, pt: p })}
                onMouseMove={(e) => setHover((h) => (h?.pt.id === p.id ? { ...h, x: e.clientX, y: e.clientY } : h))}
                onMouseLeave={() => setHover((h) => (h?.pt.id === p.id ? null : h))}
              />
              <text
                x={p.x}
                y={p.y - r - 5}
                textAnchor="middle"
                fill={hover?.pt.id === p.id ? "#e4e4e7" : "#52525b"}
                fontSize={8}
                fontFamily="ui-monospace, monospace"
                pointerEvents="none"
              >
                EX{p.ex}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Intent strip */}
      <div className="flex items-center gap-1.5 flex-wrap mt-2 px-0.5">
        {pts.map((p, i) => (
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
              <span className="text-zinc-500">tokens</span>
              <span className="text-zinc-300 text-right">{hover.pt.tokens}</span>
              <span className="text-zinc-500">mean H</span>
              <span className="text-teal-mystic text-right">{hover.pt.entropy.toFixed(3)}</span>
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
