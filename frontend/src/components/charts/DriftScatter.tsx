"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

const MARGIN = { top: 20, right: 20, bottom: 50, left: 50 };
const W = 420;
const H = 420;

const DDC_SHORT = ["Gen", "Phil", "Rel", "Soc", "Lang", "Sci", "Tech", "Art", "Lit", "Hist"];
const DDC_COLORS = ["#6b7280", "#a78bfa", "#f87171", "#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#fb923c", "#818cf8", "#2dd4bf"];

const PLOT_W = W - MARGIN.left - MARGIN.right;
const PLOT_H = H - MARGIN.top - MARGIN.bottom;

const MODEL_COLORS = [
  "#34d399", "#60a5fa", "#f87171", "#fbbf24", "#a78bfa", "#f472b6",
  "#fb923c", "#2dd4bf", "#818cf8", "#22d3ee",
];

interface Point {
  id: string;
  px: number;
  py: number;
  promptDdc: number;
  responseDdc: number;
  model?: string;
  prompt: string;
  output?: string | null;
}

interface Props {
  traces: {
    id: string;
    prompt: string;
    output?: string | null;
    model_used?: string | null;
    ddc?: { prompt?: { code?: string } | null; response?: { code?: string } | null } | null;
  }[];
}

function jitter(): number {
  return (Math.random() - 0.5) * 0.35;
}

function toSvgX(digit: number, j: number): number {
  return MARGIN.left + ((digit + j) / 9) * PLOT_W;
}

function toSvgY(digit: number, j: number): number {
  return MARGIN.top + PLOT_H - ((digit + j) / 9) * PLOT_H;
}

function axisLabel(digit: number): string {
  return `${digit} ${DDC_SHORT[digit]}`;
}

interface TooltipState {
  x: number;
  y: number;
  id: string;
  prompt: string;
  output?: string | null;
  promptDdc: string;
  responseDdc: string;
  model?: string;
}

export default function DriftScatter({ traces }: Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const modelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of traces) {
      if (t.model_used && !m.has(t.model_used)) {
        m.set(t.model_used, MODEL_COLORS[m.size % MODEL_COLORS.length]);
      }
    }
    return m;
  }, [traces]);

  const points = useMemo(() => {
    const seen = new Set<string>();
    return traces
      .map((t) => {
        const pc = t.ddc?.prompt?.code?.[0];
        const rc = t.ddc?.response?.code?.[0];
        if (!pc || !rc) return null;
        const pi = parseInt(pc);
        const ri = parseInt(rc);
        if (isNaN(pi) || isNaN(ri)) return null;
        const key = `${t.id}-${pi}-${ri}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return {
          id: t.id,
          px: pi,
          py: ri,
          promptDdc: pi,
          responseDdc: ri,
          model: t.model_used,
          prompt: t.prompt,
          output: t.output,
        } as Point;
      })
      .filter(Boolean) as Point[];
  }, [traces]);

  const handleMouseEnter = useCallback((e: React.MouseEvent, p: Point) => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    setTooltip({
      x: e.clientX, y: e.clientY,
      id: p.id,
      prompt: p.prompt,
      output: p.output,
      promptDdc: axisLabel(p.promptDdc),
      responseDdc: axisLabel(p.responseDdc),
      model: p.model,
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    tipTimer.current = setTimeout(() => setTooltip(null), 150);
  }, []);

  return (
    <div className="p-4" style={{ minHeight: "180px" }}>
      {points.length < 3 ? (
        <div className="flex items-center justify-center" style={{ minHeight: "140px" }}>
          <span className="text-[10px] font-mono text-zinc-600">Need at least 3 traces with DDC labels</span>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          <rect x={0} y={0} width={W} height={H} rx={8} fill="#0a0a0f" />

          {/* Grid lines */}
          {Array.from({ length: 10 }, (_, i) => (
            <g key={`grid-${i}`}>
              <line
                x1={MARGIN.left} y1={toSvgY(i, 0)}
                x2={MARGIN.left + PLOT_W} y2={toSvgY(i, 0)}
                stroke="rgba(255,255,255,0.06)" strokeWidth={0.5}
              />
              <line
                x1={toSvgX(i, 0)} y1={MARGIN.top}
                x2={toSvgX(i, 0)} y2={MARGIN.top + PLOT_H}
                stroke="rgba(255,255,255,0.06)" strokeWidth={0.5}
              />
            </g>
          ))}

          {/* Diagonal (no-drift line) */}
          <line
            x1={toSvgX(0, 0)} y1={toSvgY(0, 0)}
            x2={toSvgX(9, 0)} y2={toSvgY(9, 0)}
            stroke="rgba(45,212,191,0.25)" strokeWidth={1} strokeDasharray="4 3"
          />

          {/* Y axis labels */}
          <text x={10} y={MARGIN.top + PLOT_H / 2} textAnchor="middle" fill="rgba(161,161,170,0.5)" fontSize={8} fontFamily="monospace"
            transform={`rotate(-90, 10, ${MARGIN.top + PLOT_H / 2})`}>
            RESPONSE DDC DIGIT
          </text>
          {Array.from({ length: 10 }, (_, i) => (
            <text key={`yl-${i}`}
              x={MARGIN.left - 8} y={toSvgY(i, 0) + 3}
              textAnchor="end" fill={DDC_COLORS[i]} fontSize={8} fontFamily="monospace">
              {i}
            </text>
          ))}

          {/* X axis labels */}
          <text x={MARGIN.left + PLOT_W / 2} y={H - 6} textAnchor="middle" fill="rgba(161,161,170,0.5)" fontSize={8} fontFamily="monospace">
            PROMPT DDC DIGIT
          </text>
          {Array.from({ length: 10 }, (_, i) => (
            <text key={`xl-${i}`}
              x={toSvgX(i, 0)} y={MARGIN.top + PLOT_H + 16}
              textAnchor="middle" fill={DDC_COLORS[i]} fontSize={8} fontFamily="monospace">
              {i}
            </text>
          ))}

          {/* DDC_SHORT labels below digits */}
          {Array.from({ length: 10 }, (_, i) => (
            <text key={`xs-${i}`}
              x={toSvgX(i, 0)} y={MARGIN.top + PLOT_H + 28}
              textAnchor="middle" fill="rgba(161,161,170,0.35)" fontSize={6} fontFamily="monospace">
              {DDC_SHORT[i]}
            </text>
          ))}

          {/* Points */}
          {points.map((p) => {
            const jx = jitter();
            const jy = jitter();
            const cx = toSvgX(p.px, jx);
            const cy = toSvgY(p.py, jy);
            const color = p.model ? modelMap.get(p.model) || "#34d399" : "#34d399";
            return (
              <circle
                key={`pt-${p.id}`}
                cx={cx} cy={cy} r={6}
                fill={color} opacity={0.7}
                stroke="rgba(255,255,255,0.15)" strokeWidth={0.5}
                className="cursor-pointer transition-opacity hover:opacity-100"
                onMouseEnter={(e) => handleMouseEnter(e, p)}
                onMouseMove={(e) => setTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                onMouseLeave={handleMouseLeave}
              />
            );
          })}
        </svg>
      )}

      {tooltip && createPortal(
        <div
          className="fixed z-[100] pointer-events-none bg-black/85 border border-white/[0.08] rounded-lg px-3 py-2 shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10, maxWidth: "280px" }}
        >
          <div className="text-[9px] font-mono text-zinc-400">{tooltip.id}</div>
          <div className="text-[10px] font-mono text-zinc-200 mt-1 leading-tight line-clamp-2">{tooltip.prompt}</div>
          <div className="text-[9px] font-mono text-zinc-300 mt-1">
            <span style={{ color: DDC_COLORS[parseInt(tooltip.promptDdc[0])] }}>P:{tooltip.promptDdc}</span>
            {" → "}
            <span style={{ color: DDC_COLORS[parseInt(tooltip.responseDdc[0])] }}>R:{tooltip.responseDdc}</span>
          </div>
          {tooltip.model && (
            <div className="text-[9px] font-mono text-zinc-500 mt-0.5">{tooltip.model}</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
