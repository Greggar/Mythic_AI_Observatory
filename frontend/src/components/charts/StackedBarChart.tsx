"use client";

import { useMemo, useRef, useState } from "react";

const BAR_H = 22;
const BAR_GAP = 6;
const LABEL_W = 90;
const PAD = { top: 20, right: 16, bottom: 24, left: LABEL_W };
const LEGEND_H = 18;

interface Props {
  matrix: number[][];
  inputLabels: string[];
  outputLabels: string[];
  inputColors: string[];
  outputColors: string[];
  title?: string;
}

export default function StackedBarChart({ matrix, inputLabels, outputLabels, outputColors, title }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<{ row: number; col: number; value: number; pct: number } | null>(null);

  const { totals, maxTotal, W, H } = useMemo(() => {
    const t = matrix.map(row => row.reduce((s, v) => s + v, 0));
    const m = Math.max(...t, 1);
    const w = PAD.left + PAD.right + 252;
    const h = PAD.top + PAD.bottom + inputLabels.length * (BAR_H + BAR_GAP) + LEGEND_H;
    return { totals: t, maxTotal: m, W: w, H: h };
  }, [matrix, inputLabels]);

  if (!matrix.length || !inputLabels.length) {
    return (
      <div className="flex items-center justify-center h-40">
        <span className="text-[10px] font-mono text-zinc-600">No data for stacked bar chart</span>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ aspectRatio: `${W}/${H}` }}>
        {title && (
          <text x={W / 2} y={12} textAnchor="middle" fill="rgba(161,161,170,0.5)" fontSize="9" fontFamily="monospace">
            {title}
          </text>
        )}
        {/* Bars */}
        {inputLabels.map((label, i) => {
          let xOff = PAD.left;
          return (
            <g key={`bar-${i}`}>
              <text
                x={PAD.left - 6}
                y={PAD.top + i * (BAR_H + BAR_GAP) + BAR_H / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fill="rgba(161,161,170,0.6)"
                fontSize="7"
                fontFamily="monospace"
                style={{ pointerEvents: "none" }}
              >
                {label}
              </text>
              {/* Total count */}
              <text
                x={PAD.left + 2}
                y={PAD.top + i * (BAR_H + BAR_GAP) + BAR_H / 2}
                dominantBaseline="middle"
                fill="rgba(161,161,170,0.3)"
                fontSize="6"
                fontFamily="monospace"
                style={{ pointerEvents: "none" }}
              >
                {totals[i]}
              </text>
              {matrix[i].map((val, j) => {
                if (val === 0) return null;
                const pct = totals[i] > 0 ? val / totals[i] : 0;
                const w = (val / maxTotal) * 252;
                const segX = xOff;
                xOff += w;
                const isHovered = hovered?.row === i && hovered?.col === j;
                return (
                  <rect
                    key={`seg-${i}-${j}`}
                    x={segX}
                    y={PAD.top + i * (BAR_H + BAR_GAP)}
                    width={Math.max(w - 0.5, 0)}
                    height={BAR_H}
                    fill={outputColors[j] || "#374151"}
                    opacity={isHovered ? 1 : 0.65}
                    stroke={isHovered ? "rgba(45,212,191,0.6)" : "none"}
                    strokeWidth={isHovered ? 1 : 0}
                    rx={1}
                    style={{ cursor: "pointer", transition: "opacity 0.15s" }}
                    onMouseEnter={() => setHovered({ row: i, col: j, value: val, pct })}
                    onMouseLeave={() => setHovered(null)}
                  />
                );
              })}
            </g>
          );
        })}
        {/* Legend */}
        <g transform={`translate(${PAD.left}, ${PAD.top + inputLabels.length * (BAR_H + BAR_GAP) + 4})`}>
          {outputLabels.map((label, j) => (
            <g key={`leg-${j}`} transform={`translate(${j * 117}, 0)`}>
              <rect x={0} y={0} width={10} height={10} rx={1} fill={outputColors[j]} opacity={0.7} />
              <text x={14} y={8} fill="rgba(161,161,170,0.5)" fontSize="7" fontFamily="monospace">{label}</text>
            </g>
          ))}
        </g>
      </svg>
      {/* Tooltip */}
      {hovered && (
        <div
          className="fixed z-[100] bg-black/80 backdrop-blur-md border border-white/[0.08] rounded px-2 py-1 text-[10px] font-mono pointer-events-none"
          style={{
            left: PAD.left + 140,
            top: PAD.top + hovered.row * (BAR_H + BAR_GAP) + BAR_H / 2 - 20,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="text-zinc-300">{inputLabels[hovered.row]} → {outputLabels[hovered.col]}</div>
          <div className="text-teal-mystic">{hovered.value} traces ({(hovered.pct * 100).toFixed(1)}%)</div>
        </div>
      )}
    </div>
  );
}
