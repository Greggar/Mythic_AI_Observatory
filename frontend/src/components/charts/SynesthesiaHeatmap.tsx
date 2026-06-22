"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

const CELL_W = 28;
const CELL_H = 22;
const LABEL_W = 110;
const HEADER_H = 18;
const DATE_H = 32;
const GAP = 50;

interface TooltipState {
  x: number;
  y: number;
  date: string;
  category: string;
  value: number;
  side: "input" | "output";
}

interface Props {
  traces: { id: string; prompt: string; output: string | null; created_at?: string }[];
  synInputProbs: (t: any) => number[];
  synOutputProbs: (t: any) => number[];
  inputLabels: string[];
  outputLabels: string[];
}

function bucketMeanProbs(
  traces: Props["traces"],
  getProbs: (t: any) => number[],
  numCats: number
): { dateKey: string; buckets: number[]; traceCount: number }[] {
  const sumMap = new Map<string, number[]>();
  const countMap = new Map<string, number>();
  for (const t of traces) {
    const dateStr = t.created_at ? t.created_at.slice(0, 10) : "unknown";
    if (!sumMap.has(dateStr)) {
      sumMap.set(dateStr, new Array(numCats).fill(0));
      countMap.set(dateStr, 0);
    }
    const probs = getProbs(t);
    const sums = sumMap.get(dateStr)!;
    for (let i = 0; i < Math.min(probs.length, numCats); i++) {
      sums[i] += probs[i] ?? 0;
    }
    countMap.set(dateStr, countMap.get(dateStr)! + 1);
  }
  const sorted = Array.from(sumMap.entries()).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([dateKey, sums]) => {
    const cnt = countMap.get(dateKey) || 1;
    return { dateKey, buckets: sums.map((s) => s / cnt), traceCount: cnt };
  });
}

function formatDateLabel(dateKey: string): string {
  const d = new Date(dateKey + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function heatBg(value: number, maxValue: number): string {
  if (value === 0) return "rgba(255,255,255,0.04)";
  const t = Math.pow(value / Math.max(maxValue, 0.01), 0.5);
  const r = Math.round(40 + t * 215);
  const g = Math.round(140 + t * 115);
  const b = Math.round(170 + t * 85);
  return `rgb(${Math.min(r, 255)},${Math.min(g, 255)},${Math.min(b, 255)})`;
}

export default function SynesthesiaHeatmap({ traces, synInputProbs, synOutputProbs, inputLabels, outputLabels }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const inputBuckets = useMemo(
    () => bucketMeanProbs(traces, synInputProbs, inputLabels.length),
    [traces, synInputProbs, inputLabels.length]
  );
  const outputBuckets = useMemo(
    () => bucketMeanProbs(traces, synOutputProbs, outputLabels.length),
    [traces, synOutputProbs, outputLabels.length]
  );

  const maxInput = useMemo(
    () => Math.max(0.01, ...inputBuckets.flatMap((b) => b.buckets)),
    [inputBuckets]
  );
  const maxOutput = useMemo(
    () => Math.max(0.01, ...outputBuckets.flatMap((b) => b.buckets)),
    [outputBuckets]
  );

  const nCols = Math.max(inputBuckets.length, outputBuckets.length, 1);
  const sideW = LABEL_W + nCols * CELL_W;
  const W = sideW * 2 + GAP;
  const H = HEADER_H + inputLabels.length * CELL_H + DATE_H + 16;

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, dateKey: string, catIdx: number, value: number, side: "input" | "output") => {
      const cat = side === "input" ? inputLabels[catIdx] : outputLabels[catIdx];
      setTooltip({ x: e.clientX, y: e.clientY, date: formatDateLabel(dateKey), category: cat, value, side });
    },
    [inputLabels, outputLabels]
  );

  const renderHeatmap = (
    buckets: { dateKey: string; buckets: number[]; traceCount: number }[],
    labels: string[],
    maxValue: number,
    side: "input" | "output",
    offsetX: number
  ) => {
    return (
      <g transform={`translate(${offsetX}, 0)`}>
        <text x={LABEL_W / 2} y={12} textAnchor="middle" fill="rgba(161,161,170,0.7)" fontSize={9} fontFamily="monospace">
          {side === "input" ? "INPUT CATEGORIES" : "OUTPUT CATEGORIES"}
        </text>
        {labels.map((label, row) => (
          <g key={`label-${row}`}>
            <text
              x={LABEL_W - 6}
              y={HEADER_H + row * CELL_H + CELL_H / 2 + 1}
              textAnchor="end"
              fill="rgba(161,161,170,0.6)"
              fontSize={8}
              fontFamily="monospace"
            >
              {label}
            </text>
            {buckets.map((col, colIdx) => {
              const value = col.buckets[row] ?? 0;
              const x = LABEL_W + colIdx * CELL_W;
              const y = HEADER_H + row * CELL_H;
              return (
                <rect
                  key={`cell-${row}-${colIdx}`}
                  x={x}
                  y={y}
                  width={CELL_W - 2}
                  height={CELL_H - 2}
                  rx={2}
                  fill={heatBg(value, maxValue)}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onMouseEnter={(e) => handleMouseEnter(e, col.dateKey, row, value, side)}
                  onMouseMove={(e) => setTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                  onMouseLeave={() => setTooltip(null)}
                />
              );
            })}
          </g>
        ))}
        {buckets.map((col, colIdx) => (
          <text
            key={`date-${colIdx}`}
            x={LABEL_W + colIdx * CELL_W + CELL_W / 2}
            y={HEADER_H + labels.length * CELL_H + 12}
            textAnchor="end"
            fill="rgba(161,161,170,0.45)"
            fontSize={7}
            fontFamily="monospace"
            transform={`rotate(-45, ${LABEL_W + colIdx * CELL_W + CELL_W / 2}, ${HEADER_H + labels.length * CELL_H + 12})`}
          >
            {formatDateLabel(col.dateKey)}
          </text>
        ))}
      </g>
    );
  };

  return (
    <div ref={containerRef} className="p-4" style={{ minHeight: "180px" }}>
      {traces.length < 3 ? (
        <div className="flex items-center justify-center" style={{ minHeight: "140px" }}>
          <span className="text-[10px] font-mono text-zinc-600">Need at least 3 traces</span>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {renderHeatmap(inputBuckets, inputLabels, maxInput, "input", 0)}
          {renderHeatmap(outputBuckets, outputLabels, maxOutput, "output", sideW + GAP)}
        </svg>
      )}

      {tooltip && createPortal(
        <div
          className="fixed z-[100] pointer-events-none bg-black/85 border border-white/[0.08] rounded-lg px-3 py-2 shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <div className="text-[10px] font-mono text-zinc-200">{tooltip.date}</div>
          <div className="text-[9px] font-mono text-teal-mystic mt-0.5">{tooltip.category}</div>
          <div className="text-[11px] font-mono text-zinc-300 mt-0.5">
            μ = {tooltip.value.toFixed(2)}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
