"use client";

import { useMemo, useRef, useState } from "react";

const CELL = 28;
const PAD = 48;
const LABEL_W = 80;
const GAP = 1;
const COL_GAP = 14;
const ROW_GAP = 14;
const HEADER_Y = 18;
const ROW_OFFSET = 42;

type NormMode = "total" | "row" | "col";

interface Props {
  matrix: number[][];
  inputLabels: string[];
  outputLabels: string[];
  inputColors: string[];
  outputColors: string[];
  title?: string;
  total?: number;
  normMode?: NormMode;
  onNormModeChange?: (m: NormMode) => void;
  onExportCell?: (row: number, col: number) => void;
}

export default function ConfusionMatrix({ matrix, inputLabels, outputLabels, inputColors, outputColors, title, total: totalProp, normMode: externalNormMode, onNormModeChange, onExportCell }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<{ row: number; col: number; value: number; isRowTotal?: boolean; isColTotal?: boolean } | null>(null);
  const [showValues, setShowValues] = useState(true);
  const [internalNormMode, setInternalNormMode] = useState<NormMode>("total");
  const normMode = externalNormMode ?? internalNormMode;
  const setNormMode = (m: NormMode) => {
    setInternalNormMode(m);
    onNormModeChange?.(m);
  };

  const total = totalProp ?? matrix.reduce((s, row) => row.reduce((a, v) => a + v, s), 0);

  const rowTotals = useMemo(() =>
    matrix.map(row => row.reduce((a, v) => a + v, 0)),
    [matrix]
  );

  const colTotals = useMemo(() => {
    const nCol = outputLabels.length;
    const cols = Array(nCol).fill(0);
    for (const row of matrix) {
      for (let j = 0; j < nCol; j++) cols[j] += row[j] ?? 0;
    }
    return cols;
  }, [matrix, outputLabels.length]);

  const nInput = inputLabels.length;
  const nOutput = outputLabels.length;

  function normDenom(i: number, j: number): number {
    if (normMode === "row") return rowTotals[i] || 1;
    if (normMode === "col") return colTotals[j] || 1;
    return total || 1;
  }

  function normVal(i: number, j: number): number {
    return (matrix[i]?.[j] ?? 0) / normDenom(i, j);
  }

  const maxNormVal = useMemo(() => {
    let m = 0;
    for (let i = 0; i < nInput; i++) {
      for (let j = 0; j < nOutput; j++) {
        const v = normVal(i, j);
        if (v > m) m = v;
      }
    }
    return m || 1;
  }, [matrix, nInput, nOutput, normMode]);

  function pct(v: number): string {
    return `${(v * 100).toFixed(2)}%`;
  }

  const hasData = nInput > 0 && nOutput > 0;
  const showRowTotals = hasData && normMode !== "col";
  const showColTotals = hasData && normMode !== "row";
  const totalW = showRowTotals ? COL_GAP + CELL : 0;
  const totalH = showColTotals ? ROW_GAP + CELL : 0;
  const W = LABEL_W + nOutput * (CELL + GAP) + totalW + PAD;
  const H = HEADER_Y + ROW_OFFSET + nInput * (CELL + GAP) + totalH + 60;

  function cellPos(i: number, j: number) {
    const cx = j < nOutput
      ? LABEL_W + j * (CELL + GAP)
      : LABEL_W + nOutput * (CELL + GAP) + COL_GAP;
    const cy = i < nInput
      ? HEADER_Y + ROW_OFFSET + i * (CELL + GAP)
      : HEADER_Y + ROW_OFFSET + nInput * (CELL + GAP) + ROW_GAP;
    return { x: cx, y: cy };
  }

  function cellIntensity(i: number, j: number) {
    if (i < nInput && j < nOutput) return normVal(i, j) / maxNormVal;
    return 1;
  }

  function cellColor(i: number, j: number) {
    const intensity = cellIntensity(i, j);
    const r = Math.round(6 + intensity * 40);
    const g = Math.round(30 + intensity * 180);
    const b = Math.round(50 + intensity * 191);
    return `rgb(${r},${g},${b})`;
  }

  function cellOpacity(i: number, j: number, isHovered: boolean) {
    if (isHovered) return 1;
    const intensity = cellIntensity(i, j);
    return 0.6 + intensity * 0.3;
  }

  function formatNormVal(i: number, j: number): string {
    if (i < nInput && j < nOutput) return pct(normVal(i, j));
    if (i < nInput && j === nOutput) {
      if (normMode === "row") return "100.00%";
      return pct(rowTotals[i] / (total || 1));
    }
    if (i === nInput && j < nOutput) {
      if (normMode === "col") return "100.00%";
      return pct(colTotals[j] / (total || 1));
    }
    return "100.00%";
  }

  function tooltipValue(i: number, j: number): string {
    if (i < nInput && j < nOutput) {
      const modeLabel = normMode === "row" ? `of ${inputLabels[i]}` : normMode === "col" ? `of ${outputLabels[j]}` : "of total";
      return `${pct(normVal(i, j))} ${modeLabel}`;
    }
    if (i < nInput && j === nOutput) {
      if (normMode === "row") return "100.00% of row (sum)";
      return `${pct(rowTotals[i] / (total || 1))} of total`;
    }
    if (i === nInput && j < nOutput) {
      if (normMode === "col") return "100.00% of column (sum)";
      return `${pct(colTotals[j] / (total || 1))} of total`;
    }
    return "100.00%";
  }

  const normModes: { id: NormMode; label: string }[] = [
    { id: "total", label: "total" },
    { id: "row", label: "row" },
    { id: "col", label: "col" },
  ];

  if (!matrix.length || !nInput || !nOutput) {
    return (
      <div className="flex items-center justify-center h-40">
        <span className="text-[10px] font-mono text-zinc-600">No data for confusion matrix</span>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <svg width={W} height={H} className="mx-auto">
        {title && (
          <text x={W / 2} y={14} textAnchor="middle" fill="rgba(161,161,170,0.5)" fontSize="9" fontFamily="monospace">
            {title}
          </text>
        )}



        {/* Output column headers */}
        {outputLabels.map((label, j) => (
          <text
            key={`col-${j}`}
            x={LABEL_W + (j + 1) * (CELL + GAP)}
            y={HEADER_Y}
            textAnchor="end"
            fill="rgba(161,161,170,0.6)"
            fontSize="6"
            fontFamily="monospace"
            transform={`rotate(-45, ${LABEL_W + (j + 1) * (CELL + GAP)}, ${HEADER_Y})`}
            style={{ pointerEvents: "none" }}
          >
            {label}
          </text>
        ))}
        {/* Totals column header */}
        {showRowTotals && (
          <text
            x={LABEL_W + nOutput * (CELL + GAP) + COL_GAP + CELL}
            y={HEADER_Y}
            textAnchor="end"
            fill="rgba(45,212,191,0.5)"
            fontSize="6"
            fontFamily="monospace"
            style={{ pointerEvents: "none" }}
          >
            Total
          </text>
        )}

        {/* Vertical separator */}
        {showRowTotals && (
          <line
            x1={LABEL_W + nOutput * (CELL + GAP) + COL_GAP - 6}
            y1={HEADER_Y - 4}
            x2={LABEL_W + nOutput * (CELL + GAP) + COL_GAP - 6}
            y2={HEADER_Y + ROW_OFFSET + nInput * (CELL + GAP) + (nInput > 0 ? totalH : 0) + 4}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={0.5}
          />
        )}

        {/* Rows */}
        {inputLabels.map((label, i) => (
          <g key={`row-${i}`}>
            <text
              x={LABEL_W - 4}
              y={HEADER_Y + ROW_OFFSET + i * (CELL + GAP) + CELL / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fill="rgba(161,161,170,0.6)"
              fontSize="7"
              fontFamily="monospace"
              style={{ pointerEvents: "none" }}
            >
              {label}
            </text>
            {/* Data cells */}
            {outputLabels.map((_, j) => {
              const isHovered = hovered?.row === i && hovered?.col === j && !hovered.isRowTotal && !hovered.isColTotal;
              const pos = cellPos(i, j);
              return (
                <g key={`cell-${i}-${j}`}>
                  <rect
                    x={pos.x}
                    y={pos.y}
                    width={CELL}
                    height={CELL}
                    rx={2}
                    fill={cellColor(i, j)}
                    opacity={cellOpacity(i, j, isHovered)}
                    stroke={isHovered ? "rgba(45,212,191,0.6)" : "rgba(255,255,255,0.05)"}
                    strokeWidth={isHovered ? 1.5 : 0.5}
                    style={{ cursor: "pointer", transition: "opacity 0.15s" }}
                    onMouseEnter={() => setHovered({ row: i, col: j, value: matrix[i]?.[j] ?? 0 })}
                    onMouseLeave={() => setHovered(null)}
                  />
                  {showValues && (
                    <text
                      x={pos.x + CELL / 2}
                      y={pos.y + CELL / 2 + 1}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="rgba(255,255,255,0.85)"
                      fontSize="5.5"
                      fontFamily="monospace"
                      style={{ pointerEvents: "none" }}
                    >
                      {formatNormVal(i, j)}
                    </text>
                  )}
                </g>
              );
            })}
            {/* Row totals cell */}
            {showRowTotals && (
              <g key={`rt-${i}`}>
                <rect
                  x={cellPos(i, nOutput).x}
                  y={cellPos(i, nOutput).y}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  fill="rgba(45,212,191,0.12)"
                  opacity={hovered?.row === i && hovered?.col === nOutput ? 0.9 : 0.5}
                  stroke={hovered?.row === i && hovered?.col === nOutput ? "rgba(45,212,191,0.4)" : "rgba(45,212,191,0.05)"}
                  strokeWidth={hovered?.row === i && hovered?.col === nOutput ? 1 : 0.3}
                  style={{ cursor: "pointer", transition: "opacity 0.15s" }}
                  onMouseEnter={() => setHovered({ row: i, col: nOutput, value: rowTotals[i], isRowTotal: true })}
                  onMouseLeave={() => setHovered(null)}
                />
                {showValues && (
                  <text
                    x={cellPos(i, nOutput).x + CELL / 2}
                    y={cellPos(i, nOutput).y + CELL / 2 + 1}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="rgba(45,212,191,0.85)"
                    fontSize="5.5"
                    fontFamily="monospace"
                    style={{ pointerEvents: "none" }}
                  >
                    {formatNormVal(i, nOutput)}
                  </text>
                )}
              </g>
            )}
          </g>
        ))}

        {/* Horizontal separator */}
        {showColTotals && (
          <line
            x1={LABEL_W - 4}
            y1={HEADER_Y + ROW_OFFSET + nInput * (CELL + GAP) + ROW_GAP - 6}
            x2={LABEL_W + nOutput * (CELL + GAP) + totalW + 4}
            y2={HEADER_Y + ROW_OFFSET + nInput * (CELL + GAP) + ROW_GAP - 6}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={0.5}
          />
        )}

        {/* Totals row */}
        {showColTotals && outputLabels.map((_, j) => {
          const pos = cellPos(nInput, j);
          return (
            <g key={`ct-${j}`}>
              <rect
                x={pos.x}
                y={pos.y}
                width={CELL}
                height={CELL}
                rx={2}
                fill="rgba(45,212,191,0.12)"
                opacity={hovered?.row === nInput && hovered?.col === j ? 0.9 : 0.5}
                stroke={hovered?.row === nInput && hovered?.col === j ? "rgba(45,212,191,0.4)" : "rgba(45,212,191,0.05)"}
                strokeWidth={hovered?.row === nInput && hovered?.col === j ? 1 : 0.3}
                style={{ cursor: "pointer", transition: "opacity 0.15s" }}
                onMouseEnter={() => setHovered({ row: nInput, col: j, value: colTotals[j], isColTotal: true })}
                onMouseLeave={() => setHovered(null)}
              />
              {showValues && (
                <text
                  x={pos.x + CELL / 2}
                  y={pos.y + CELL / 2 + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="rgba(45,212,191,0.85)"
                  fontSize="5.5"
                  fontFamily="monospace"
                  style={{ pointerEvents: "none" }}
                >
                  {formatNormVal(nInput, j)}
                </text>
              )}
            </g>
          );
        })}
        {/* Grand total cell */}
        {showRowTotals && showColTotals && (
          <g>
            <rect
              x={cellPos(nInput, nOutput).x}
              y={cellPos(nInput, nOutput).y}
              width={CELL}
              height={CELL}
              rx={2}
              fill="rgba(45,212,191,0.18)"
              opacity={hovered?.row === nInput && hovered?.col === nOutput ? 0.9 : 0.5}
              stroke={hovered?.row === nInput && hovered?.col === nOutput ? "rgba(45,212,191,0.4)" : "rgba(45,212,191,0.05)"}
              strokeWidth={hovered?.row === nInput && hovered?.col === nOutput ? 1 : 0.3}
              style={{ cursor: "pointer", transition: "opacity 0.15s" }}
              onMouseEnter={() => setHovered({ row: nInput, col: nOutput, value: total })}
              onMouseLeave={() => setHovered(null)}
            />
            {showValues && (
              <text
                x={cellPos(nInput, nOutput).x + CELL / 2}
                y={cellPos(nInput, nOutput).y + CELL / 2 + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="rgba(45,212,191,0.85)"
                fontSize="5.5"
                fontFamily="monospace"
                style={{ pointerEvents: "none" }}
              >
                100.00%
              </text>
            )}
          </g>
        )}

        {/* Color intensity scale */}
        <g transform={`translate(${LABEL_W - 60}, ${H - 16})`}>
          <text x={0} y={0} fill="rgba(161,161,170,0.3)" fontSize="6" fontFamily="monospace">
            {normMode === "row" ? "darker = higher % of row" : normMode === "col" ? "darker = higher % of column" : "darker = higher % of total"}
          </text>
        </g>
      </svg>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 mt-2">
        <div className="flex items-center gap-1">
          {normModes.map(m => (
            <button
              key={m.id}
              onClick={() => setNormMode(m.id)}
              className={`text-[9px] font-mono px-2 py-0.5 rounded transition-all ${
                normMode === m.id
                  ? "bg-teal-mystic/15 text-teal-mystic border border-teal-mystic/30"
                  : "text-zinc-500 border border-white/[0.08] hover:border-white/[0.15]"
              }`}
            >
              {m.label}%
            </button>
          ))}
        </div>
        <span className="text-[8px] text-zinc-700">|</span>
        <button
          onClick={() => setShowValues(v => !v)}
          className={`text-[9px] font-mono px-2 py-0.5 rounded transition-all border ${
            showValues
              ? "bg-teal-mystic/15 text-teal-mystic border-teal-mystic/30"
              : "text-zinc-500 border-white/[0.08] hover:border-white/[0.15]"
          }`}
        >
          values {showValues ? "on" : "off"}
        </button>
      </div>

      {/* Tooltip */}
      {hovered && (() => {
        const ctPos = cellPos(hovered.row, hovered.col);
        const tx = ctPos.x + CELL / 2;
        const ty = ctPos.y;
        let label: string;
        if (hovered.isRowTotal) {
          label = `${inputLabels[hovered.row]} (total)`;
        } else if (hovered.isColTotal) {
          label = `${outputLabels[hovered.col]} (total)`;
        } else if (hovered.row === nInput && hovered.col === nOutput) {
          label = "Grand total";
        } else {
          label = `${inputLabels[hovered.row]} → ${outputLabels[hovered.col]}`;
        }
        return (
          <div
            className="fixed z-[100] bg-black/90 backdrop-blur-md border border-white/[0.10] rounded-lg px-3 py-2 text-[10px] font-mono"
            style={{
              left: tx + 60,
              top: ty - 8,
              transform: "translate(-50%, -100%)",
            }}
          >
            <div className="text-zinc-300 mb-0.5">{label}</div>
            <div className="text-teal-mystic mb-0.5">{tooltipValue(hovered.row, hovered.col)}</div>
            <div className="text-[8px] text-zinc-600">{hovered.value.toFixed(2)} raw weight</div>
            {onExportCell && hovered.row < nInput && hovered.col < nOutput && (
              <button
                onClick={() => onExportCell(hovered.row, hovered.col)}
                className="text-[9px] text-zinc-500 hover:text-teal-mystic transition-colors flex items-center gap-1 mt-1"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export CSV
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
}
