"use client";
import { useState, useRef, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import type { TraceSession } from "@/types/trace";

interface RetrievedChunk {
  trace_id: string;
  content: string;
  relevance: number;
  used: boolean;
}

interface LinkedSentence {
  text: string;
  chunkIndex: number;
  overlap: number;
}

const CHUNK_COLORS = [
  { border: "#2dd4bf", bg: "rgba(45, 212, 191, 0.08)", label: "teal" },
  { border: "#a78bfa", bg: "rgba(167, 139, 250, 0.08)", label: "violet" },
  { border: "#fbbf24", bg: "rgba(251, 191, 36, 0.08)", label: "amber" },
  { border: "#60a5fa", bg: "rgba(96, 165, 250, 0.08)", label: "blue" },
  { border: "#f472b6", bg: "rgba(244, 114, 182, 0.08)", label: "pink" },
];

const DISCARDED_COLORS = [
  { border: "#5b8a7e", bg: "rgba(45, 212, 191, 0.03)", label: "teal" },
  { border: "#6b5b8a", bg: "rgba(167, 139, 250, 0.03)", label: "violet" },
  { border: "#8a7e5b", bg: "rgba(251, 191, 36, 0.03)", label: "amber" },
  { border: "#5b6e8a", bg: "rgba(96, 165, 250, 0.03)", label: "blue" },
  { border: "#8a5b6e", bg: "rgba(244, 114, 182, 0.03)", label: "pink" },
];

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

function splitAndLink(
  output: string,
  chunks: RetrievedChunk[]
): { text: string; link: LinkedSentence | null }[] {
  const sentenceEnd = /(?<=[.!?])\s+/;
  const parts = output.split(sentenceEnd);
  return parts.map((text) => {
    const trimmed = text.trim();
    if (!trimmed) return { text, link: null };
    const words = trimmed.split(/\W+/).filter(Boolean);
    if (words.length < 5) return { text, link: null };

    let bestIdx = -1;
    let bestOverlap = 0;
    for (let i = 0; i < chunks.length; i++) {
      const overlap = wordOverlap(trimmed, chunks[i].content);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIdx = i;
      }
    }
    if (bestOverlap >= 0.15 && bestIdx >= 0) {
      return { text, link: { text: trimmed, chunkIndex: bestIdx, overlap: bestOverlap } };
    }
    return { text, link: null };
  });
}

function truncateId(id: string): string {
  if (id.length <= 14) return id;
  return id.slice(0, 14) + "…";
}

interface SynthesisBridgeProps {
  trace: TraceSession;
}

export default function SynthesisBridge({ trace }: SynthesisBridgeProps) {
  const [hoveredData, setHoveredData] = useState<{
    x: number;
    y: number;
    link: LinkedSentence;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const chunks = useMemo(() => {
    const mrStep = trace.steps.find((s) => s.label === "Memory Retrieval");
    return (mrStep?.metadata?.retrieved_chunks as RetrievedChunk[] | undefined) || [];
  }, [trace]);

  const output = trace.output || "";

  const segments = useMemo(
    () => (chunks.length > 0 && output ? splitAndLink(output, chunks) : []),
    [chunks, output]
  );

  const linkedCount = segments.filter((s) => s.link).length;

  if (!output || chunks.length === 0) return null;

  const paletteFor = (idx: number, used: boolean) => {
    const pal = used ? CHUNK_COLORS : DISCARDED_COLORS;
    return pal[idx % pal.length];
  };

  return (
    <div
      ref={containerRef}
      className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05] space-y-2"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-teal-mystic/70">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
          <span className="text-[9px] font-semibold tracking-widest uppercase">Synthesis Bridge</span>
        </div>
        <span className="text-[8px] font-mono text-zinc-600">
          {linkedCount}/{segments.length} sentences linked
        </span>
      </div>
      <div className="text-[8px] font-mono text-zinc-600 leading-relaxed">
        Colored underlines trace influence from retrieved context to final output.
        {linkedCount === 0 && " No direct sentence-level links detected."}
      </div>

      {linkedCount > 0 && (
        <div className="flex flex-wrap gap-2">
          {chunks.map((chunk, i) => {
            const segCount = segments.filter((s) => s.link?.chunkIndex === i).length;
            if (segCount === 0) return null;
            const c = paletteFor(i, chunk.used);
            return (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.border }} />
                <span className="text-[8px] font-mono text-zinc-600">
                  {truncateId(chunk.trace_id)}
                  {chunk.used ? "" : " (discarded)"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="relative text-[11px] font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap">
        {segments.length > 0
          ? segments.map((seg, i) => {
              if (!seg.link) {
                return <span key={i}>{seg.text} </span>;
              }
              const chunk = chunks[seg.link.chunkIndex];
              const c = paletteFor(seg.link.chunkIndex, chunk.used);
              const opacityStr = (0.3 + 0.6 * seg.link.overlap).toFixed(2);
              const isHovered =
                hoveredData?.link.chunkIndex === seg.link.chunkIndex &&
                hoveredData?.link.text === seg.link.text;
              return (
                <span
                  key={i}
                  className="relative inline cursor-pointer rounded-sm transition-colors"
                  style={{
                    borderBottom: `1.5px solid ${c.border}`,
                    backgroundColor: isHovered ? c.bg : "transparent",
                  }}
                  onMouseMove={(e) => {
                    if (!seg.link) return;
                    setHoveredData({ x: e.clientX, y: e.clientY, link: seg.link });
                  }}
                  onMouseLeave={() => setHoveredData(null)}
                >
                  {seg.text}{" "}
                </span>
              );
            })
          : output}
      </div>

      {hoveredData &&
        createPortal(
          <div
            className="fixed z-[100] p-2.5 rounded-lg text-[10px] font-mono leading-relaxed whitespace-pre-wrap pointer-events-none"
            style={{
              backgroundColor: "#1a1a2e",
              border: "1px solid rgba(167, 139, 250, 0.25)",
              color: "rgba(212, 212, 216, 0.9)",
              boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
              left: hoveredData.x + 12,
              top: hoveredData.y - 10,
              maxWidth: 360,
            }}
          >
            {(() => {
              const link = hoveredData.link;
              const chunk = chunks[link.chunkIndex];
              const c = paletteFor(link.chunkIndex, chunk.used);
              return (
                <>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: c.border }}
                    />
                    <span className="text-zinc-300 font-semibold">{truncateId(chunk.trace_id)}</span>
                    <span
                      className={`text-[8px] px-1 rounded ${
                        chunk.used
                          ? "bg-emerald-900/40 text-emerald-400"
                          : "bg-zinc-700/40 text-zinc-400"
                      }`}
                    >
                      {chunk.used ? "USED" : "DISCARDED"}
                    </span>
                  </div>
                  <div className="flex gap-3 mb-1.5 text-[9px]">
                    <span className="text-teal-mystic">rel {Math.round(chunk.relevance * 100)}%</span>
                    <span className="text-violet-glow">overlap {Math.round(link.overlap * 100)}%</span>
                  </div>
                  <div className="text-zinc-500 text-[9px] leading-relaxed line-clamp-4 border-t border-white/[0.06] pt-1.5 mt-1">
                    {chunk.content.slice(0, 300)}
                  </div>
                </>
              );
            })()}
          </div>,
          document.body
        )}
    </div>
  );
}
