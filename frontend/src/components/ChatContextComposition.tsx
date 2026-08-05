"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { TraceSession } from "@/types/trace";

interface Props {
  exchanges: TraceSession[];
}

interface RetrievedChunk {
  trace_id: string;
  content: string;
  relevance: number;
  used: boolean;
}

interface SourceStats {
  fresh: number;
  history: number;
  memory: number;
  total: number;
}

interface Row {
  id: string;
  ex: number;
  prompt: string;
  freshTokens: number;
  historyUsed: number;
  historyDiscarded: number;
  memoryUsed: number;
  memoryDiscarded: number;
  historyChunks: RetrievedChunk[];
  memoryChunks: RetrievedChunk[];
  usedCount: number;
  discardedCount: number;
}

const DISCARDED_MULT = 0.35;

const COLORS = {
  fresh: "#a78bfa",
  history: "#2dd4bf",
  memory: "#fbbf24",
  discarded: "#52525b",
};

function estTokens(s: string): number {
  return Math.max(1, Math.ceil(s.length / 4));
}

function retrievedChunks(t: TraceSession): RetrievedChunk[] {
  const step = t.steps?.find((s) => s.label === "Memory Retrieval");
  return (step?.metadata?.retrieved_chunks as RetrievedChunk[] | undefined) || [];
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}

export default function ChatContextComposition({ exchanges }: Props) {
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    row: Row;
    source: "fresh" | "history" | "memory";
  } | null>(null);

  const rows: Row[] = useMemo(() => {
    const sorted = [...exchanges]
      .filter((t) => t.status === "complete")
      .sort((a, b) => (a.exchange_index ?? 0) - (b.exchange_index ?? 0));

    const ids = new Set(sorted.map((t) => t.id));

    return sorted.map((t) => {
      const chunks = retrievedChunks(t);
      const history = chunks.filter((c) => ids.has(c.trace_id));
      const memory = chunks.filter((c) => !ids.has(c.trace_id));

      const split = (arr: RetrievedChunk[]) => ({
        used: arr.filter((c) => c.used).reduce((s, c) => s + estTokens(c.content), 0),
        discarded: arr
          .filter((c) => !c.used)
          .reduce((s, c) => s + estTokens(c.content) * DISCARDED_MULT, 0),
      });

      const h = split(history);
      const m = split(memory);

      return {
        id: t.id,
        ex: t.exchange_index ?? 0,
        prompt: t.prompt,
        freshTokens: estTokens(t.prompt),
        historyUsed: h.used,
        historyDiscarded: h.discarded,
        memoryUsed: m.used,
        memoryDiscarded: m.discarded,
        historyChunks: history,
        memoryChunks: memory,
        usedCount: chunks.filter((c) => c.used).length,
        discardedCount: chunks.filter((c) => !c.used).length,
      };
    });
  }, [exchanges]);

  const aggregate: SourceStats | null = useMemo(() => {
    if (rows.length === 0) return null;
    const acc = { fresh: 0, history: 0, memory: 0, total: 0 };
    for (const r of rows) {
      acc.fresh += r.freshTokens;
      acc.history += r.historyUsed + r.historyDiscarded;
      acc.memory += r.memoryUsed + r.memoryDiscarded;
    }
    acc.total = acc.fresh + acc.history + acc.memory;
    return acc;
  }, [rows]);

  if (rows.length === 0) return null;

  const pct = (v: number, total: number) => (total > 0 ? (v / total) * 100 : 0);

  const hoveredStats = (row: Row, source: "fresh" | "history" | "memory") => {
    if (source === "fresh") {
      return { label: "Fresh prompt", tokens: row.freshTokens, count: 1, chunks: [] };
    }
    const isHist = source === "history";
    const chunks = isHist ? row.historyChunks : row.memoryChunks;
    const used = isHist ? row.historyUsed : row.memoryUsed;
    const discarded = isHist ? row.historyDiscarded : row.memoryDiscarded;
    return {
      label: isHist ? "History carry-over" : "External memory",
      tokens: used + discarded,
      used,
      discarded,
      count: chunks.length,
      chunks,
    };
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="glass-panel p-4"
    >
      <div className="flex items-center justify-between px-0.5 mb-2">
        <span className="text-[9px] font-mono tracking-wider text-zinc-600 uppercase">
          Context-Source Composition
        </span>
        <div className="flex items-center gap-3 text-[9px] font-mono text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: COLORS.fresh }} />
            fresh
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: COLORS.history }} />
            history
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: COLORS.memory }} />
            memory
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-sm opacity-70"
              style={{ background: "repeating-linear-gradient(45deg, #52525b 0 2px, transparent 2px 4px)" }}
            />
            discarded
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        {rows.map((row) => {
          const total =
            row.freshTokens + row.historyUsed + row.historyDiscarded + row.memoryUsed + row.memoryDiscarded;

          const allSegments: { key: string; source: "fresh" | "history" | "memory"; w: number; used: boolean }[] = [
            { key: "fresh", source: "fresh", w: row.freshTokens, used: true },
            { key: "hist-u", source: "history", w: row.historyUsed, used: true },
            { key: "hist-d", source: "history", w: row.historyDiscarded, used: false },
            { key: "mem-u", source: "memory", w: row.memoryUsed, used: true },
            { key: "mem-d", source: "memory", w: row.memoryDiscarded, used: false },
          ];
          const segments = allSegments.filter((s) => s.w > 0);

          return (
            <div key={row.id} className="flex items-center gap-3">
              <span className="w-8 shrink-0 text-right text-[9px] font-mono text-zinc-500">
                EX{row.ex}
              </span>
              <div className="flex-1 h-4 rounded bg-white/[0.03] overflow-hidden flex">
                {segments.map((seg) => (
                  <div
                    key={seg.key}
                    className="h-full transition-opacity"
                    style={{
                      width: `${pct(seg.w, total)}%`,
                      backgroundColor: COLORS[seg.source],
                      opacity: seg.used ? 0.95 : 0.45,
                      backgroundImage: seg.used
                        ? undefined
                        : "repeating-linear-gradient(45deg, rgba(0,0,0,0.25) 0 2px, transparent 2px 4px)",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, row, source: seg.source })}
                    onMouseMove={(e) =>
                      setHover((h) => (h?.row === row && h.source === seg.source ? { ...h, x: e.clientX, y: e.clientY } : h))
                    }
                    onMouseLeave={() => setHover((h) => (h?.row === row && h.source === seg.source ? null : h))}
                  />
                ))}
              </div>
              <div className="w-12 shrink-0 text-[9px] font-mono text-zinc-600">
                {Math.round(pct(row.freshTokens, total))}%
              </div>
            </div>
          );
        })}
      </div>

      {aggregate && (
        <div className="flex items-center gap-3 mt-2.5 pt-2 border-t border-white/[0.06] px-0.5">
          <span className="w-8 shrink-0 text-right text-[9px] font-mono text-zinc-600 uppercase">
            avg
          </span>
          <div className="flex-1 h-1.5 rounded bg-white/[0.03] overflow-hidden flex">
            <div style={{ width: `${pct(aggregate.fresh, aggregate.total)}%`, backgroundColor: COLORS.fresh, opacity: 0.95 }} />
            <div style={{ width: `${pct(aggregate.history, aggregate.total)}%`, backgroundColor: COLORS.history, opacity: 0.95 }} />
            <div style={{ width: `${pct(aggregate.memory, aggregate.total)}%`, backgroundColor: COLORS.memory, opacity: 0.95 }} />
          </div>
          <div className="w-12 shrink-0" />
        </div>
      )}

      {hover && typeof document !== "undefined" && (
        createPortal(
          <div
            className="fixed z-[100] pointer-events-none glass-panel p-3 w-80 space-y-1.5"
            style={{ left: Math.min(hover.x + 14, window.innerWidth - 340), top: Math.min(hover.y + 14, window.innerHeight - 320) }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-zinc-300">
                EX{hover.row.ex} · {hoveredStats(hover.row, hover.source).label}
              </span>
              <span
                className="text-[8px] px-1.5 py-0.5 rounded font-mono"
                style={{
                  color: COLORS[hover.source],
                  backgroundColor: `${COLORS[hover.source]}1a`,
                }}
              >
                {hover.source}
              </span>
            </div>
            {(() => {
              const s = hoveredStats(hover.row, hover.source);
              if (hover.source === "fresh") {
                return (
                  <div className="text-[9px] font-mono text-zinc-500 leading-relaxed border-t border-white/[0.06] pt-1.5 line-clamp-3">
                    “{truncate(hover.row.prompt, 220)}”
                  </div>
                );
              }
              return (
                <div className="space-y-1">
                  <div className="text-[9px] font-mono">
                    <span className="text-zinc-400">~{s.tokens} est. tokens</span>
                    <span className="text-zinc-600"> · </span>
                    <span className="text-emerald-400">{s.used} used</span>
                    <span className="text-zinc-600"> · </span>
                    <span className="text-zinc-500">{s.discarded} discarded</span>
                  </div>
                  {s.chunks.slice(0, 3).map((c, i) => (
                    <div key={i} className="text-[9px] font-mono text-zinc-500 leading-snug border-t border-white/[0.05] pt-1">
                      <span className={c.used ? "text-teal-mystic" : "text-zinc-600"}>
                        {c.used ? "USED" : "DISC"} rel {Math.round(c.relevance * 100)}%
                      </span>
                      <span className="text-zinc-600"> · </span>
                      {truncate(c.content, 90)}
                    </div>
                  ))}
                  {s.chunks.length === 0 && (
                    <div className="text-[9px] font-mono text-zinc-600">no chunks from this source</div>
                  )}
                </div>
              );
            })()}
          </div>,
          document.body
        )
      )}
    </motion.div>
  );
}
