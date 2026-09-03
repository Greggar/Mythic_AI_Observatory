"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

const CELL_W = 28;
const CELL_H = 22;
const LABEL_W = 110;
const HEADER_H = 18;
const DATE_H = 32;
const GAP = 50;

const DDC_SHORT = ["Gen", "Phil", "Rel", "Soc", "Lang", "Sci", "Tech", "Art", "Lit", "Hist"];
const DDC_COLORS = ["#6b7280", "#a78bfa", "#f87171", "#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#fb923c", "#818cf8", "#2dd4bf"];

interface TooltipState {
  x: number;
  y: number;
  date: string;
  digit: number;
  count: number;
  total: number;
  pct: number;
  side: "prompt" | "response";
}

interface Props {
  traces: {
    id: string;
    ddc?: { prompt?: { code?: string } | null; response?: { code?: string } | null } | null;
    created_at?: string;
  }[];
}

function formatDateLabel(dateKey: string): string {
  const d = new Date(dateKey + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function heatBg(ratio: number): string {
  if (ratio === 0) return "rgba(255,255,255,0.04)";
  const t = Math.pow(ratio, 0.5);
  const r = Math.round(40 + t * 215);
  const g = Math.round(140 + t * 115);
  const b = Math.round(170 + t * 85);
  return `rgb(${Math.min(r, 255)},${Math.min(g, 255)},${Math.min(b, 255)})`;
}

interface DateBucket {
  dateKey: string;
  counts: number[];
  total: number;
  traces: number;
}

function buildBuckets(
  traces: Props["traces"],
  getDigit: (t: Props["traces"][number]) => number | null
): DateBucket[] {
  const map = new Map<string, number[]>();
  const traceMap = new Map<string, number>();
  for (const t of traces) {
    const dateStr = t.created_at ? t.created_at.slice(0, 10) : "unknown";
    if (!map.has(dateStr)) {
      map.set(dateStr, new Array(10).fill(0));
      traceMap.set(dateStr, 0);
    }
    const digit = getDigit(t);
    const counts = map.get(dateStr)!;
    if (digit !== null && digit >= 0 && digit <= 9) {
      counts[digit] += 1;
    }
    traceMap.set(dateStr, traceMap.get(dateStr)! + 1);
  }
  const sorted = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([dateKey, counts]) => ({
    dateKey,
    counts,
    total: counts.reduce((s, v) => s + v, 0),
    traces: traceMap.get(dateKey) || 0,
  }));
}

export default function DriftHeatmap({ traces }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const getPromptDigit = useCallback((t: Props["traces"][number]): number | null => {
    const c = t.ddc?.prompt?.code;
    if (!c) return null;
    const d = parseInt(c[0]);
    return isNaN(d) ? null : d;
  }, []);

  const getResponseDigit = useCallback((t: Props["traces"][number]): number | null => {
    const c = t.ddc?.response?.code;
    if (!c) return null;
    const d = parseInt(c[0]);
    return isNaN(d) ? null : d;
  }, []);

  const promptBuckets = useMemo(() => buildBuckets(traces, getPromptDigit), [traces, getPromptDigit]);
  const responseBuckets = useMemo(() => buildBuckets(traces, getResponseDigit), [traces, getResponseDigit]);

  const maxPrompt = useMemo(
    () => Math.max(0.01, ...promptBuckets.flatMap((b) => b.counts)),
    [promptBuckets]
  );
  const maxResponse = useMemo(
    () => Math.max(0.01, ...responseBuckets.flatMap((b) => b.counts)),
    [responseBuckets]
  );

  const nCols = Math.max(promptBuckets.length, responseBuckets.length, 1);
  const sideW = LABEL_W + nCols * CELL_W;
  const W = sideW * 2 + GAP;
  const H = HEADER_H + 10 * CELL_H + DATE_H + 16;

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, bucket: DateBucket, digit: number, count: number, side: "prompt" | "response") => {
      setTooltip({
        x: e.clientX, y: e.clientY,
        date: formatDateLabel(bucket.dateKey),
        digit,
        count,
        total: bucket.total,
        pct: bucket.total > 0 ? (count / bucket.total) * 100 : 0,
        side,
      });
    },
    []
  );

  const renderHeatmap = (
    buckets: DateBucket[],
    maxValue: number,
    side: "prompt" | "response",
    offsetX: number
  ) => {
    return (
      <g transform={`translate(${offsetX}, 0)`}>
        <text x={LABEL_W / 2} y={12} textAnchor="middle" fill="rgba(161,161,170,0.7)" fontSize={9} fontFamily="monospace">
          {side === "prompt" ? "PROMPT DDC DIGITS" : "RESPONSE DDC DIGITS"}
        </text>
        {DDC_SHORT.map((label, row) => (
          <g key={`label-${row}`}>
            <text
              x={LABEL_W - 6}
              y={HEADER_H + row * CELL_H + CELL_H / 2 + 1}
              textAnchor="end"
              fill={DDC_COLORS[row]}
              fontSize={8}
              fontFamily="monospace"
            >
              {row} {label}
            </text>
            {buckets.map((col, colIdx) => {
              const value = col.counts[row] ?? 0;
              const x = LABEL_W + colIdx * CELL_W;
              const y = HEADER_H + row * CELL_H;
              const ratio = maxValue > 0 ? value / maxValue : 0;
              return (
                <rect
                  key={`cell-${row}-${colIdx}`}
                  x={x}
                  y={y}
                  width={CELL_W - 2}
                  height={CELL_H - 2}
                  rx={2}
                  fill={heatBg(ratio)}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onMouseEnter={(e) => handleMouseEnter(e, col, row, value, side)}
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
            y={HEADER_H + 10 * CELL_H + 12}
            textAnchor="end"
            fill="rgba(161,161,170,0.45)"
            fontSize={7}
            fontFamily="monospace"
            transform={`rotate(-45, ${LABEL_W + colIdx * CELL_W + CELL_W / 2}, ${HEADER_H + 10 * CELL_H + 12})`}
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
          {renderHeatmap(promptBuckets, maxPrompt, "prompt", 0)}
          {renderHeatmap(responseBuckets, maxResponse, "response", sideW + GAP)}
        </svg>
      )}

      {tooltip && createPortal(
        <div
          className="fixed z-[100] pointer-events-none bg-black/85 border border-white/[0.08] rounded-lg px-3 py-2 shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <div className="text-[10px] font-mono text-zinc-200">{tooltip.date}</div>
          <div className="text-[9px] font-mono mt-0.5" style={{ color: DDC_COLORS[tooltip.digit] }}>
            DDC {tooltip.digit} {DDC_SHORT[tooltip.digit]}
          </div>
          <div className="text-[11px] font-mono text-zinc-300 mt-0.5">
            {tooltip.count} trace{tooltip.count !== 1 ? "s" : ""} ({tooltip.pct.toFixed(1)}%)
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
