"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { arc as d3Arc } from "d3";
import { createPortal } from "react-dom";

const INPUT_LABELS = ["Direct Command", "Factual Question", "Creative Request", "Simple Query", "Complex Inquiry"];
const OUTPUT_LABELS = ["Concise List/Facts", "Prose Explanation", "Creative/Verse", "Bulleted List", "Technical/Code"];
const INPUT_COLORS = ["#60a5fa", "#f472b6", "#34d399", "#a78bfa", "#fb923c"];
const OUTPUT_COLORS = ["#60a5fa", "#f472b6", "#34d399", "#a78bfa", "#fb923c"];

const W = 440;
const H = 440;
const CX = W / 2;
const CY = H / 2;
const INNER = 50;
const MID = 120;
const OUTER = 200;
const GAP = 0.008;

function classifySynesthPrompt(text: string): number {
  const creativeWords = /\b(sonnet|poem|poetry|verse|lyric|story|tale|narrative|metaphor|imagine|creative|song|ballad|haiku|limerick|ode|elegy|prose|fiction|fantasy|sci-fi|fable|myth)\b/i;
  if (creativeWords.test(text)) return 2;
  if (/\?\s*$/.test(text) || /^(what|how|why|when|where|who|whom|whose|which|could|would|should|can|will|do|does|did|is|are|was|were)\b/i.test(text)) return 1;
  if (/^(list|write|tell|show|give|create|build|find|explain|describe|summarize|generate|make|name|enumerate|state|define|compile|produce|draft|compose|prepare)\b/i.test(text)) return 0;
  if (text.split(/\s+/).length > 12) return 4;
  return 3;
}

function classifySynesthResponse(text: string): number {
  if (/```/.test(text)) return 4;
  if (/^[-*\u2022]\s/m.test(text) || /^\d+[.)]\s/m.test(text)) return 3;
  if (text.split(/\s+/).length < 30) return 0;
  if (text.split("\n").length >= 8) {
    const lines = text.split("\n");
    const avgLen = lines.reduce((s, l) => s + l.split(/\s+/).length, 0) / lines.length;
    if (avgLen < 14) return 2;
  }
  return 1;
}

function getInputProbs(t: { prompt: string; synesth?: { input_probs?: number[] } }): number[] {
  if (t.synesth?.input_probs) return t.synesth.input_probs;
  const i = classifySynesthPrompt(t.prompt);
  return [0, 0, 0, 0, 0].map((_, idx) => (idx === i ? 1 : 0));
}

function getOutputProbs(t: { prompt: string; output: string | null; synesth?: { output_probs?: number[] } }): number[] {
  if (t.synesth?.output_probs) return t.synesth.output_probs;
  const i = classifySynesthResponse(t.output || "");
  return [0, 0, 0, 0, 0].map((_, idx) => (idx === i ? 1 : 0));
}

function safe(a: number) {
  return isNaN(a) || !isFinite(a) ? 0 : a;
}

interface Wedge {
  path: string;
  label: string;
  count: number;
  pct: string;
  depth: 0 | 1;
  color: string;
  startAngle: number;
  endAngle: number;
  inputIdx: number;
  outputIdx: number | null;
}

interface Props {
  traces: { id: string; prompt: string; output: string | null; synesth?: { input_probs?: number[]; output_probs?: number[] } }[];
}

export default function SynesthSunburst({ traces }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<{ wedge: Wedge; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const wedges = useMemo<Wedge[]>(() => {
    // Build 5x5 count matrix: counts[inputIdx][outputIdx]
    const counts = Array.from({ length: 5 }, () => Array(5).fill(0));
    let total = 0;
    for (const t of traces) {
      if (!t.output) continue;
      const ip = getInputProbs(t);
      const op = getOutputProbs(t);
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          const w = ip[i] * op[j];
          if (w > 0) {
            counts[i][j] += w;
            if (j === 0) total += w; // count once per trace via first output category
          }
        }
      }
    }

    const inputTotals = counts.map((row) => row.reduce((s, v) => s + v, 0));
    const grandTotal = inputTotals.reduce((s, v) => s + v, 0);
    if (grandTotal === 0) return [];

    const result: Wedge[] = [];
    const arcGen = d3Arc();
    let cursor = -Math.PI / 2;

    for (let i = 0; i < 5; i++) {
      const inTotal = inputTotals[i];
      if (inTotal === 0) continue;
      const ia = (inTotal / grandTotal) * 2 * Math.PI;

      // Inner ring wedge (depth 0 — input category)
      arcGen({
        innerRadius: INNER,
        outerRadius: MID,
        startAngle: safe(cursor + GAP),
        endAngle: safe(cursor + ia - GAP),
      });
      const innerPath = arcGen({
        innerRadius: INNER,
        outerRadius: MID,
        startAngle: safe(cursor + GAP),
        endAngle: safe(cursor + ia - GAP),
      }) || "";
      result.push({
        path: innerPath,
        label: INPUT_LABELS[i],
        count: Math.round(inTotal),
        pct: ((inTotal / grandTotal) * 100).toFixed(1),
        depth: 0,
        color: INPUT_COLORS[i],
        startAngle: cursor,
        endAngle: cursor + ia,
        inputIdx: i,
        outputIdx: null,
      });

      // Outer ring wedges (depth 1 — output categories within this input)
      let outCursor = cursor;
      for (let j = 0; j < 5; j++) {
        const val = counts[i][j];
        if (val === 0) { outCursor += (0 / inTotal) * ia; continue; }
        const oa = (val / inTotal) * ia;
        const outPath = arcGen({
          innerRadius: MID + 2,
          outerRadius: OUTER,
          startAngle: safe(outCursor + GAP),
          endAngle: safe(outCursor + oa - GAP),
        }) || "";
        result.push({
          path: outPath,
          label: OUTPUT_LABELS[j],
          count: Math.round(val),
          pct: ((val / grandTotal) * 100).toFixed(1),
          depth: 1,
          color: OUTPUT_COLORS[j],
          startAngle: outCursor,
          endAngle: outCursor + oa,
          inputIdx: i,
          outputIdx: j,
        });
        outCursor += oa;
      }
      cursor += ia;
    }

    return result;
  }, [traces]);

  const handleMouseEnter = useCallback((e: React.MouseEvent, wedge: Wedge) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHovered({
      wedge,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setHovered((prev) => {
      if (!prev) return null;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return prev;
      return { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top };
    });
  }, []);

  if (wedges.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: "180px" }}>
        <span className="text-[10px] font-mono text-zinc-600">No data for synesthesia sunburst</span>
      </div>
    );
  }

  const total = wedges.filter((w) => w.depth === 0).reduce((s, w) => s + w.count, 0);

  return (
    <div ref={containerRef} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ aspectRatio: `${W}/${H}` }} preserveAspectRatio="xMidYMid meet">
        <g transform={`translate(${CX}, ${CY})`}>
          {/* Center label */}
          <text textAnchor="middle" y={-4} fill="rgba(161,161,170,0.4)" fontSize="8" fontFamily="monospace">
            Synesthesia
          </text>
          <text textAnchor="middle" y={8} fill="rgba(161,161,170,0.6)" fontSize="10" fontFamily="monospace" fontWeight={600}>
            {total}
          </text>
          <text textAnchor="middle" y={20} fill="rgba(161,161,170,0.25)" fontSize="7" fontFamily="monospace">
            traces
          </text>

          {/* Wedges */}
          {wedges.map((w, idx) => {
            const isDimmed = selected !== null && w.inputIdx !== selected;
            const fillColor = isDimmed ? w.color + "22" : w.depth === 0 ? w.color : w.color + "cc";
            return (
              <path
                key={`${w.depth}-${w.inputIdx}-${w.outputIdx ?? "all"}-${idx}`}
                d={w.path}
                fill={fillColor}
                stroke={isDimmed ? "transparent" : "rgba(255,255,255,0.06)"}
                strokeWidth={0.5}
                opacity={isDimmed ? 0.3 : 1}
                className="transition-all duration-200 cursor-pointer"
                onClick={() => setSelected(selected === w.inputIdx ? null : w.inputIdx)}
                onMouseEnter={(e) => handleMouseEnter(e, w)}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}
        </g>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {INPUT_LABELS.map((label, i) => (
          <button
            key={label}
            onClick={() => setSelected(selected === i ? null : i)}
            className={`flex items-center gap-1 transition-opacity ${
              selected !== null && selected !== i ? "opacity-30" : ""
            }`}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: INPUT_COLORS[i] }} />
            <span className="text-[8px] font-mono text-zinc-500">{label}</span>
          </button>
        ))}
      </div>

      {/* Tooltip portal */}
      {hovered && createPortal(
        (() => {
          const gap = 10;
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return null;
          const sx = rect.left + hovered.x;
          const sy = rect.top + hovered.y;
          const tw = 200;
          const left = sx > window.innerWidth / 2 ? sx - tw - gap : sx + gap;
          const top = sy > window.innerHeight / 2 ? sy - 70 : sy + gap;
          return (
            <div
              className="fixed z-[100] pointer-events-none bg-black/80 backdrop-blur-md border border-white/[0.08] rounded-lg px-3 py-2 shadow-xl"
              style={{ left, top }}
            >
              <div className="text-[10px] font-semibold text-zinc-200">
                {hovered.wedge.depth === 0 ? INPUT_LABELS[hovered.wedge.inputIdx] : OUTPUT_LABELS[hovered.wedge.outputIdx!]}
              </div>
              {hovered.wedge.depth === 1 && (
                <div className="text-[8px] font-mono text-zinc-500 mt-0.5">
                  in {INPUT_LABELS[hovered.wedge.inputIdx]}
                </div>
              )}
              <div className="text-[9px] font-mono text-teal-mystic mt-1">
                {hovered.wedge.count} traces ({hovered.wedge.pct}%)
              </div>
            </div>
          );
        })(),
        document.body
      )}
    </div>
  );
}
