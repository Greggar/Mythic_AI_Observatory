"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { TraceSession } from "@/types/trace";

interface Props {
  exchanges: TraceSession[];
  onSelectExchange: (traceId: string) => void;
}

interface Pt {
  id: string;
  ex: number;
  intent: string;
  prompt: string;
  output: string;
  time: string;
  model: string | null;
}

interface RefLink {
  fromIdx: number;
  toIdx: number;
  kind: "retrieval" | "lexical";
  strength: number;
  used: boolean | null;
  relevance: number | null;
  sample: string;
}

interface RetrievedChunk {
  trace_id: string;
  content: string;
  relevance: number;
  used: boolean;
}

const INTENT_COLORS = [
  "#2dd4bf", "#a78bfa", "#fbbf24", "#60a5fa",
  "#f472b6", "#fb923c", "#34d399", "#c084fc",
];

const W = 720;
const H = 200;
const PAD = { l: 36, r: 14, t: 18, b: 34 };

const MIN_SENTENCE_WORDS = 5;
const MIN_OVERLAP = 0.15;

function sentenceSplit(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let common = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) common++;
  }
  return common / Math.max(wordsA.size, wordsB.size);
}

function bestSentenceOverlap(a: string, b: string): { overlap: number; sample: string } {
  const sentencesB = sentenceSplit(b).filter((s) => s.split(/\W+/).filter(Boolean).length >= MIN_SENTENCE_WORDS);
  if (sentencesB.length === 0) return { overlap: 0, sample: "" };
  let best = 0;
  let bestSample = "";
  for (const s of sentencesB) {
    const o = wordOverlap(a, s);
    if (o > best) {
      best = o;
      bestSample = s;
    }
  }
  return { overlap: best, sample: bestSample };
}

function extractIntent(t: TraceSession): string {
  const step = t.steps?.find((s) => s.label === "Intent Classification");
  const probs = step?.metadata?.intent_probs;
  if (Array.isArray(probs) && probs.length > 0 && probs[0]) {
    return String((probs[0] as { label?: string }).label ?? "");
  }
  return "";
}

function retrievedChunks(t: TraceSession): RetrievedChunk[] {
  const step = t.steps?.find((s) => s.label === "Memory Retrieval");
  return (step?.metadata?.retrieved_chunks as RetrievedChunk[] | undefined) || [];
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}

export default function ChatReferenceMap({ exchanges, onSelectExchange }: Props) {
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    link: RefLink;
    fromEx: number;
    toEx: number;
  } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);

  const { pts, links, intentColor } = useMemo(() => {
    const sorted = [...exchanges]
      .filter((t) => t.status === "complete")
      .sort((a, b) => (a.exchange_index ?? 0) - (b.exchange_index ?? 0));

    const colorOf = new Map<string, string>();
    let next = 0;
    const p: Pt[] = sorted.map((t) => {
      const intent = extractIntent(t);
      if (!colorOf.has(intent)) colorOf.set(intent, INTENT_COLORS[next++ % INTENT_COLORS.length]);
      return {
        id: t.id,
        ex: t.exchange_index ?? 0,
        intent,
        prompt: t.prompt,
        output: t.output || "",
        time: t.created_at?.slice(11, 19) ?? "",
        model: t.model_used,
      };
    });

    if (p.length < 2) return { pts: p, links: [], intentColor: colorOf };

    const linksOut: RefLink[] = [];

    // Ground-truth: memory retrieval pulled a chunk from an earlier exchange.
    for (let i = 0; i < p.length; i++) {
      const chunks = retrievedChunks(exchanges.find((t) => t.id === p[i].id) as TraceSession);
      for (const chunk of chunks) {
        const j = p.findIndex((q) => q.id === chunk.trace_id);
        if (j >= 0 && j < i) {
          linksOut.push({
            fromIdx: j,
            toIdx: i,
            kind: "retrieval",
            strength: Math.max(0, Math.min(1, chunk.relevance ?? 0)),
            used: chunk.used,
            relevance: chunk.relevance,
            sample: truncate(chunk.content, 220),
          });
        }
      }
    }

    // Lexical: exchange i's language echoes an earlier exchange's output.
    for (let i = 1; i < p.length; i++) {
      let bestJ = -1;
      let bestOverlap = 0;
      let bestSample = "";
      for (let j = 0; j < i; j++) {
        const { overlap, sample } = bestSentenceOverlap(p[i].prompt, p[j].output);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestJ = j;
          bestSample = sample;
        }
      }
      if (bestJ >= 0 && bestOverlap >= MIN_OVERLAP) {
        linksOut.push({
          fromIdx: bestJ,
          toIdx: i,
          kind: "lexical",
          strength: Math.max(0, Math.min(1, bestOverlap)),
          used: null,
          relevance: null,
          sample: truncate(bestSample, 220),
        });
      }
    }

    return { pts: p, links: linksOut, intentColor: colorOf };
  }, [exchanges]);

  const baseY = H - PAD.b;

  if (pts.length === 0) return null;

  const n = pts.length;
  const x = (i: number) => PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (n - 1)) * (W - PAD.l - PAD.r));

  const arcPath = (link: RefLink): string => {
    const x1 = x(link.fromIdx);
    const x2 = x(link.toIdx);
    const span = Math.abs(x2 - x1);
    const h = Math.min(36 + span * 0.18 + link.strength * 22, baseY - PAD.t - 16);
    const mx = (x1 + x2) / 2;
    const y1 = baseY;
    const y2 = baseY - h;
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${mx.toFixed(1)} ${y2.toFixed(1)}, ${mx.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y1.toFixed(1)}`;
  };

  const isLinkActive = (link: RefLink) =>
    hover?.link === link || hoveredNode === link.fromIdx || hoveredNode === link.toIdx;

  const retrievalCount = links.filter((l) => l.kind === "retrieval").length;
  const lexicalCount = links.filter((l) => l.kind === "lexical").length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="glass-panel p-4"
    >
      <div className="flex items-center justify-between px-0.5 mb-2">
        <span className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">
          Cross-Turn Reference Map
        </span>
        <div className="flex items-center gap-3 text-[9px] font-mono text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded bg-teal-mystic" />
            retrieved ({retrievalCount})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded bg-violet-400 border-t border-dashed border-violet-400" />
            echo ({lexicalCount})
          </span>
        </div>
      </div>

      {links.length === 0 ? (
        <div className="text-[10px] font-mono text-zinc-600 px-0.5">
          No cross-turn references detected — each exchange stands alone.
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Cross-turn reference arcs between chat exchanges">
          {/* Arcs */}
          {links.map((link, i) => {
            const active = isLinkActive(link);
            const isRetrieval = link.kind === "retrieval";
            return (
              <path
                key={`${link.fromIdx}-${link.toIdx}-${link.kind}`}
                d={arcPath(link)}
                fill="none"
                stroke={isRetrieval ? "#2dd4bf" : "#a78bfa"}
                strokeWidth={isRetrieval ? 2 : 1.4}
                strokeOpacity={active ? 1 : 0.16}
                strokeDasharray={isRetrieval ? undefined : "4 3"}
                className="transition-opacity"
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) =>
                  setHover({
                    x: e.clientX,
                    y: e.clientY,
                    link,
                    fromEx: pts[link.fromIdx].ex,
                    toEx: pts[link.toIdx].ex,
                  })
                }
                onMouseMove={(e) =>
                  setHover((h) => (h?.link === link ? { ...h, x: e.clientX, y: e.clientY } : h))
                }
                onMouseLeave={() => setHover((h) => (h?.link === link ? null : h))}
              />
            );
          })}

          {/* Baseline */}
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={baseY}
            y2={baseY}
            stroke="#ffffff"
            strokeOpacity={0.07}
            strokeWidth={1}
          />

          {/* Nodes */}
          {pts.map((p, i) => {
            const onHoveredLink = hover != null && (hover.link.fromIdx === i || hover.link.toIdx === i);
            const dimmed =
              (hover != null && !onHoveredLink) ||
              (hoveredNode != null && hoveredNode !== i);
            const isHovered = hoveredNode === i;
            return (
              <g
                key={p.id}
                style={{ cursor: "pointer" }}
                onClick={() => onSelectExchange(p.id)}
                onMouseEnter={() => setHoveredNode(i)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <circle
                  cx={x(i)}
                  cy={baseY}
                  r={isHovered ? 7 : 4.5}
                  fill={intentColor.get(p.intent) ?? "#2dd4bf"}
                  stroke="#0a0a0a"
                  strokeWidth={1.2}
                  opacity={dimmed ? 0.25 : 1}
                  className="transition-all"
                />
                <text
                  x={x(i)}
                  y={H - PAD.b + 14}
                  textAnchor="middle"
                  fill={isHovered ? "#e4e4e7" : "#52525b"}
                  fontSize={8.5}
                  fontFamily="ui-monospace, monospace"
                  pointerEvents="none"
                >
                  EX{p.ex}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {/* Intent strip — same as trajectory for consistency */}
      <div className="flex items-center gap-1.5 flex-wrap mt-2 px-0.5">
        {pts.map((p, i) => (
          <div key={`${p.id}-strip`} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-[9px] text-zinc-700">→</span>}
            <button
              onClick={() => onSelectExchange(p.id)}
              className={`flex items-center gap-1.5 text-[9px] font-mono px-2 py-1 rounded-full border transition-colors ${
                hoveredNode === i
                  ? "border-white/20 text-zinc-200"
                  : "border-white/[0.06] text-zinc-500 hover:text-zinc-300"
              }`}
              onMouseEnter={() => setHoveredNode(i)}
              onMouseLeave={() => setHoveredNode(null)}
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
            className="fixed z-[100] pointer-events-none glass-panel p-3 w-80 space-y-1.5"
            style={{ left: Math.min(hover.x + 14, window.innerWidth - 320), top: Math.min(hover.y + 14, window.innerHeight - 260) }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-teal-mystic">
                EX{hover.fromEx} → EX{hover.toEx}
              </span>
              <span
                className={`text-[8px] px-1.5 py-0.5 rounded font-mono ${
                  hover.link.kind === "retrieval"
                    ? "bg-teal-mystic/10 text-teal-mystic"
                    : "bg-violet-400/10 text-violet-300"
                }`}
              >
                {hover.link.kind === "retrieval" ? "RETRIEVED" : "ECHO"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <span className="text-zinc-400">
                {hover.link.kind === "retrieval"
                  ? `memory pulled a chunk from EX${hover.fromEx}`
                  : `EX${hover.toEx} echoes EX${hover.fromEx}`}
              </span>
            </div>
            <div className="flex gap-3 text-[9px] font-mono">
              {hover.link.relevance != null && (
                <span className="text-teal-mystic">
                  rel {Math.round(hover.link.relevance * 100)}%
                </span>
              )}
              {hover.link.used != null && (
                <span className={hover.link.used ? "text-emerald-400" : "text-zinc-500"}>
                  {hover.link.used ? "USED" : "DISCARDED"}
                </span>
              )}
              <span className="text-violet-glow">
                overlap {Math.round(hover.link.strength * 100)}%
              </span>
            </div>
            <div className="text-[9px] font-mono text-zinc-500 leading-relaxed border-t border-white/[0.06] pt-1.5 line-clamp-3">
              “{hover.link.sample}”
            </div>
            <div className="text-[9px] font-mono text-zinc-600">
              prompt of EX{hover.toEx}: {truncate(pts[hover.link.toIdx].prompt, 140)}
            </div>
          </div>,
          document.body
        )
      )}
    </motion.div>
  );
}
