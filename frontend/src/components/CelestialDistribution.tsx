"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHover } from "@/lib/HoverContext";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
const W = 280;
const H = 160;
const PAD = { left: 40, right: 15, top: 15, bottom: 22 };
const LEGEND_Y = 2;

interface HistoryEntry {
  id: string;
  prompt: string;
  status: string;
  created_at: string;
  output: string | null;
  steps: { duration_ms: number | null }[];
}

interface Props {
  refreshTrigger: number;
  onSelect: (traceId: string) => void;
}

function totalDuration(steps: { duration_ms: number | null }[]): number {
  return steps.reduce((s, st) => s + (st.duration_ms || 0), 0);
}

export default function CelestialDistribution({ refreshTrigger, onSelect }: Props) {
  const { hoveredTraceId, setHoveredTraceId } = useHover();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [localHover, setLocalHover] = useState<{ entry: HistoryEntry; x: number; y: number } | null>(null);
  const [legendHover, setLegendHover] = useState<{
    label: string;
    value: string;
    definition: string;
    implication: string;
    x: number;
    y: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => setMounted(true), []);

  const clearHover = useCallback(() => {
    setHoveredTraceId(null);
    hoverTimeout.current = setTimeout(() => setLocalHover(null), 120);
  }, [setHoveredTraceId]);

  const keepHover = useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/traces?limit=40`)
      .then((r) => r.json())
      .then((data) => setEntries(data))
      .catch(() => {});
  }, [refreshTrigger]);

  const dots = useMemo(() => {
    if (entries.length === 0) return [];

    const maxDur = Math.max(...entries.map((e) => totalDuration(e.steps)), 1);
    const sorted = [...entries].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    return sorted.map((entry, i) => {
      const dur = totalDuration(entry.steps);
      const x = PAD.left + (dur / maxDur) * plotW;
      const y = PAD.top + plotH * 0.2 + (i / Math.max(sorted.length - 1, 1)) * plotH * 0.6;
      return { x, y, entry, duration: dur };
    });
  }, [entries]);

  const xTicks = useMemo(() => {
    if (entries.length === 0) return [];
    const maxDur = Math.max(...entries.map((e) => totalDuration(e.steps)), 1);
    const n = 4;
    return Array.from({ length: n }, (_, i) => {
      const val = (maxDur / (n - 1)) * i;
      const x = PAD.left + (val / maxDur) * (W - PAD.left - PAD.right);
      return { x, label: val > 1000 ? `${(val / 1000).toFixed(0)}s` : `${Math.round(val)}ms` };
    });
  }, [entries]);

  const stats = useMemo(() => {
    if (entries.length === 0) return null;
    const durs = entries.map((e) => totalDuration(e.steps));
    const n = durs.length;

    const sum = durs.reduce((a, b) => a + b, 0);
    const mean = sum / n;

    const sorted = [...durs].sort((a, b) => a - b);
    const median = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];

    const variance = durs.reduce((acc, d) => acc + (d - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);

    const binCount = Math.min(Math.max(Math.floor(Math.sqrt(n)), 3), 10);
    const minDur = Math.min(...durs);
    const maxDur = Math.max(...durs);
    const binW = (maxDur - minDur) / binCount || 1;
    const bins = Array.from({ length: binCount }, () => 0);
    for (const d of durs) {
      const idx = Math.min(Math.floor((d - minDur) / binW), binCount - 1);
      bins[idx]++;
    }
    const modeBin = bins.indexOf(Math.max(...bins));
    const mode = minDur + modeBin * binW + binW / 2;

    return { mean, median, mode, std, count: n };
  }, [entries]);

  const toPlotX = useCallback(
    (val: number) => {
      const maxDur = Math.max(...entries.map((e) => totalDuration(e.steps)), 1);
      const plotW = W - PAD.left - PAD.right;
      return PAD.left + (val / maxDur) * plotW;
    },
    [entries]
  );

  return (
    <>
    <div className="glass-panel p-4 space-y-3">
      <div className="flex flex-col items-center gap-1.5 text-teal-mystic">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 12h18" opacity="0.4" />
          <path d="M12 3v18" opacity="0.4" />
          <circle cx="8" cy="8" r="2" fill="currentColor" opacity="0.6" />
          <circle cx="16" cy="14" r="3" fill="currentColor" opacity="0.4" />
          <circle cx="12" cy="18" r="1.5" fill="currentColor" opacity="0.3" />
        </svg>
        <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
          Runtime Distribution
        </span>
      </div>

      <div
        ref={containerRef}
        className="relative rounded-lg"
        style={{ background: "linear-gradient(180deg, #041824 0%, #0a2d38 50%, #06303d 100%)" }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          <defs>
            <linearGradient id="dist-glow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(45,212,191,0)" />
              <stop offset="50%" stopColor="rgba(45,212,191,0.03)" />
              <stop offset="100%" stopColor="rgba(45,212,191,0)" />
            </linearGradient>
          </defs>
          <rect x={0} y={0} width={W} height={H} rx={8} fill="url(#dist-glow)" />

          <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom}
            stroke="rgba(45,212,191,0.12)" strokeWidth={0.5} />

          {xTicks.map((t, i) => (
            <g key={`t${i}`}>
              <line x1={t.x} y1={H - PAD.bottom} x2={t.x} y2={H - PAD.bottom + 4}
                stroke="rgba(45,212,191,0.15)" strokeWidth={0.5} />
              <text x={t.x} y={H - 4} textAnchor="middle"
                fill="rgba(45,212,191,0.25)" fontSize="6.5" fontFamily="monospace">
                {t.label}
              </text>
            </g>
          ))}

          {stats && (
            <>
              {/* ±2σ band */}
              <rect
                x={toPlotX(stats.mean - 2 * stats.std)}
                y={PAD.top}
                width={toPlotX(stats.mean + 2 * stats.std) - toPlotX(stats.mean - 2 * stats.std)}
                height={H - PAD.top - PAD.bottom}
                fill="rgba(45,212,191,0.04)"
                rx={2}
              />
              <text x={toPlotX(stats.mean + 2 * stats.std) - 2} y={PAD.top + 8}
                textAnchor="end" fill="rgba(45,212,191,0.2)" fontSize="5" fontFamily="monospace">
                ±2σ
              </text>
              {/* ±1σ band */}
              <rect
                x={toPlotX(stats.mean - stats.std)}
                y={PAD.top}
                width={toPlotX(stats.mean + stats.std) - toPlotX(stats.mean - stats.std)}
                height={H - PAD.top - PAD.bottom}
                fill="rgba(45,212,191,0.07)"
                rx={2}
              />
              <text x={toPlotX(stats.mean + stats.std) - 2} y={PAD.top + 18}
                textAnchor="end" fill="rgba(45,212,191,0.3)" fontSize="5" fontFamily="monospace">
                ±1σ
              </text>
              {/* Mean vertical line */}
              <line
                x1={toPlotX(stats.mean)} y1={PAD.top}
                x2={toPlotX(stats.mean)} y2={H - PAD.bottom}
                stroke="rgba(251,191,36,0.3)" strokeWidth={0.8}
                strokeDasharray="2 2"
              />

              {/* Mean marker — circle with cross */}
              <g>
                <circle cx={toPlotX(stats.mean)} cy={PAD.top + 6} r={4}
                  fill="none" stroke="#fbbf24" strokeWidth={1} />
                <line x1={toPlotX(stats.mean) - 2.5} y1={PAD.top + 6}
                  x2={toPlotX(stats.mean) + 2.5} y2={PAD.top + 6}
                  stroke="#fbbf24" strokeWidth={0.8} />
                <line x1={toPlotX(stats.mean)} y1={PAD.top + 3.5}
                  x2={toPlotX(stats.mean)} y2={PAD.top + 8.5}
                  stroke="#fbbf24" strokeWidth={0.8} />
              </g>

              {/* Median marker — diamond */}
              <polygon
                points={`${toPlotX(stats.median)},${PAD.top + 2} ${toPlotX(stats.median) + 4},${PAD.top + 6} ${toPlotX(stats.median)},${PAD.top + 10} ${toPlotX(stats.median) - 4},${PAD.top + 6}`}
                fill="none" stroke="#a78bfa" strokeWidth={1}
              />

              {/* Mode marker — triangle */}
              <polygon
                points={`${toPlotX(stats.mode)},${PAD.top + 1} ${toPlotX(stats.mode) + 4.5},${PAD.top + 9} ${toPlotX(stats.mode) - 4.5},${PAD.top + 9}`}
                fill="none" stroke="#34d399" strokeWidth={1}
              />
            </>
          )}

          {dots.length === 0 && (
            <text x={W / 2} y={H / 2} textAnchor="middle"
              fill="rgba(82,82,91,0.6)" fontSize="10" fontFamily="monospace">
              No traces yet
            </text>
          )}

          {dots.length > 1 && (
            <path
              d={dots.map((d, i) => `${i === 0 ? "M" : "L"}${d.x.toFixed(2)} ${d.y.toFixed(2)}`).join(" ")}
              fill="none" stroke="rgba(45,212,191,0.06)" strokeWidth={0.5}
            />
          )}

          {dots.map((dot) => {
            const isCrossHovered = hoveredTraceId !== null && hoveredTraceId === dot.entry.id;
            const isDimmed = hoveredTraceId !== null && !isCrossHovered;

            return (
              <motion.g
                key={dot.entry.id}
                onClick={() => onSelect(dot.entry.id)}
                style={{ cursor: "pointer" }}
                initial={{ opacity: 0, scale: 0 }}
                animate={mounted ? { opacity: isDimmed ? 0.15 : 1, scale: 1 } : {}}
                transition={{ duration: 0.3 }}
                whileHover={{ scale: isDimmed ? 1 : 2 }}
                onMouseEnter={(e) => {
                  keepHover();
                  setHoveredTraceId(dot.entry.id);
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (rect) {
                    setLocalHover({ entry: dot.entry, x: e.clientX - rect.left, y: e.clientY - rect.top });
                  }
                }}
                onMouseLeave={clearHover}
              >
                {isCrossHovered && (
                  <circle cx={dot.x} cy={dot.y} r={6}
                    fill="none" stroke="#2dd4bf" strokeWidth={1}
                    opacity={0.6}
                  />
                )}
                <circle cx={dot.x} cy={dot.y} r={3}
                  fill={isCrossHovered ? "#2dd4bf" : "rgba(45,212,191,0.6)"}
                  stroke={isCrossHovered ? "rgba(45,212,191,0.8)" : "rgba(45,212,191,0.3)"}
                  strokeWidth={0.5}
                />
              </motion.g>
            );
          })}

          <text x={4} y={PAD.top + 6}
            fill="rgba(45,212,191,0.15)" fontSize="5.5" fontFamily="monospace" transform={`rotate(-90, 4, ${PAD.top + 6})`}>
            newest
          </text>
          <text x={4} y={H - PAD.bottom - 2}
            fill="rgba(45,212,191,0.15)" fontSize="5.5" fontFamily="monospace" transform={`rotate(-90, 4, ${H - PAD.bottom - 2})`}>
            oldest
          </text>

          <text x={W / 2} y={H - 1}
            textAnchor="middle" fill="rgba(45,212,191,0.15)" fontSize="5.5" fontFamily="monospace">
            runtime →
          </text>

          {stats && (
            <>
              {/* Legend */}
              <line x1={PAD.left} y1={LEGEND_Y - 4} x2={W - PAD.right} y2={LEGEND_Y - 4}
                stroke="rgba(45,212,191,0.08)" strokeWidth={0.5} />

              {/* Mean */}
              <g style={{ cursor: "help" }}
                onMouseEnter={(e) => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setLegendHover({
                    label: "Mean (average)",
                    value: stats.mean > 1000 ? `${(stats.mean / 1000).toFixed(1)}s` : `${Math.round(stats.mean)}ms`,
                    definition: "Sum of all runtimes divided by the number of traces.",
                    implication: stats.mean > stats.median
                      ? `Above the median — a few slow traces are pulling the average up.`
                      : `Close to the median — the distribution is roughly symmetric.`,
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                  });
                }}
                onMouseLeave={() => setLegendHover(null)}
              >
                <circle cx={PAD.left + 2} cy={LEGEND_Y + 4} r={3}
                  fill="none" stroke="#fbbf24" strokeWidth={0.8} />
                <line x1={PAD.left + 2 - 2} y1={LEGEND_Y + 4}
                  x2={PAD.left + 2 + 2} y2={LEGEND_Y + 4}
                  stroke="#fbbf24" strokeWidth={0.7} />
                <line x1={PAD.left + 2} y1={LEGEND_Y + 4 - 2}
                  x2={PAD.left + 2} y2={LEGEND_Y + 4 + 2}
                  stroke="#fbbf24" strokeWidth={0.7} />
                <text x={PAD.left + 8} y={LEGEND_Y + 5}
                  fill="rgba(251,191,36,0.5)" fontSize="6" fontFamily="monospace">
                  mean
                </text>
                <text x={PAD.left + 8} y={LEGEND_Y + 14}
                  fill="rgba(251,191,36,0.3)" fontSize="5.5" fontFamily="monospace">
                  {stats.mean > 1000 ? `${(stats.mean / 1000).toFixed(1)}s` : `${Math.round(stats.mean)}ms`}
                </text>
              </g>

              {/* Median */}
              <g style={{ cursor: "help" }}
                onMouseEnter={(e) => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setLegendHover({
                    label: "Median (50th percentile)",
                    value: stats.median > 1000 ? `${(stats.median / 1000).toFixed(1)}s` : `${Math.round(stats.median)}ms`,
                    definition: "The middle value when all runtimes are sorted from fastest to slowest.",
                    implication: stats.median < stats.mean
                      ? `Below the mean — more than half of traces are faster than average.`
                      : `Close to the mean — no extreme outliers pulling the average.`,
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                  });
                }}
                onMouseLeave={() => setLegendHover(null)}
              >
                <polygon
                  points={`${PAD.left + 52},${LEGEND_Y + 2} ${PAD.left + 52 + 3},${LEGEND_Y + 6} ${PAD.left + 52},${LEGEND_Y + 10} ${PAD.left + 52 - 3},${LEGEND_Y + 6}`}
                  fill="none" stroke="#a78bfa" strokeWidth={0.8} />
                <text x={PAD.left + 58} y={LEGEND_Y + 5}
                  fill="rgba(167,139,250,0.5)" fontSize="6" fontFamily="monospace">
                  median
                </text>
                <text x={PAD.left + 58} y={LEGEND_Y + 14}
                  fill="rgba(167,139,250,0.3)" fontSize="5.5" fontFamily="monospace">
                  {stats.median > 1000 ? `${(stats.median / 1000).toFixed(1)}s` : `${Math.round(stats.median)}ms`}
                </text>
              </g>

              {/* Mode */}
              <g style={{ cursor: "help" }}
                onMouseEnter={(e) => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setLegendHover({
                    label: "Mode (most frequent)",
                    value: stats.mode > 1000 ? `${(stats.mode / 1000).toFixed(1)}s` : `${Math.round(stats.mode)}ms`,
                    definition: "The runtime that appears most often across all traces.",
                    implication: stats.mode < stats.mean
                      ? `Below the mean — most traces cluster at a faster time, with a long tail of slower ones.`
                      : `Close to the mean — the most common runtime is representative of the whole set.`,
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                  });
                }}
                onMouseLeave={() => setLegendHover(null)}
              >
                <polygon
                  points={`${PAD.left + 105},${LEGEND_Y + 1} ${PAD.left + 105 + 3.5},${LEGEND_Y + 8} ${PAD.left + 105 - 3.5},${LEGEND_Y + 8}`}
                  fill="none" stroke="#34d399" strokeWidth={0.8} />
                <text x={PAD.left + 111} y={LEGEND_Y + 5}
                  fill="rgba(52,211,153,0.5)" fontSize="6" fontFamily="monospace">
                  mode
                </text>
                <text x={PAD.left + 111} y={LEGEND_Y + 14}
                  fill="rgba(52,211,153,0.3)" fontSize="5.5" fontFamily="monospace">
                  {stats.mode > 1000 ? `${(stats.mode / 1000).toFixed(1)}s` : `${Math.round(stats.mode)}ms`}
                </text>
              </g>

              {/* SD indicator */}
              <text x={PAD.left + 158} y={LEGEND_Y + 5}
                fill="rgba(45,212,191,0.4)" fontSize="6" fontFamily="monospace">
                σ
              </text>
              <text x={PAD.left + 171} y={LEGEND_Y + 5}
                fill="rgba(45,212,191,0.3)" fontSize="5.5" fontFamily="monospace">
                {stats.std > 1000 ? `${(stats.std / 1000).toFixed(1)}s` : `${Math.round(stats.std)}ms`}
              </text>

              {/* Count */}
              <text x={W - PAD.right} y={LEGEND_Y + 5}
                textAnchor="end" fill="rgba(45,212,191,0.2)" fontSize="5.5" fontFamily="monospace">
                n={stats.count}
              </text>
            </>
          )}
        </svg>
      </div>
    </div>
      {localHover && (() => {
        const gap = 8;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return null;
        const sx = rect.left + localHover.x;
        const sy = rect.top + localHover.y;
        const tw = 160;
        const onRight = sx > window.innerWidth / 2;
        const left = onRight ? sx - tw - gap : sx + gap;
        const onBottom = sy > window.innerHeight / 2;
        const top = onBottom ? sy - 80 : sy + gap;
        return (
          <div
            className="fixed z-50"
            style={{ left, top }}
            onMouseEnter={keepHover}
            onMouseLeave={clearHover}
          >
            <div className="bg-[rgba(6,30,40,0.92)] backdrop-blur-sm border border-teal-mystic/20 rounded-md px-2.5 py-1.5 shadow-lg max-w-[160px]">
              <p className="text-[10px] leading-tight text-teal-mystic/90 line-clamp-2">
                {localHover.entry.prompt}
              </p>
              <div className="flex items-center gap-2 mt-1 text-[9px] text-zinc-400">
                <span>{totalDuration(localHover.entry.steps) > 1000
                  ? `${(totalDuration(localHover.entry.steps) / 1000).toFixed(1)}s`
                  : `${totalDuration(localHover.entry.steps)}ms`}</span>
                <span>· {new Date(localHover.entry.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>
          </div>
        );
      })()}

      {legendHover && (() => {
        const gap = 10;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return null;
        const sx = rect.left + legendHover.x;
        const sy = rect.top + legendHover.y;
        const tw = 200;
        const onRight = sx > window.innerWidth / 2;
        const left = onRight ? sx - tw - gap : sx + gap;
        const onBottom = sy > window.innerHeight / 2;
        const top = onBottom ? sy - 100 : sy + gap;
        return (
          <div
            className="fixed z-50"
            style={{ left, top }}
          >
            <div className="bg-[rgba(6,30,40,0.95)] backdrop-blur-sm border border-teal-mystic/20 rounded-md px-3 py-2 shadow-lg max-w-[200px] space-y-1">
              <p className="text-[11px] font-semibold leading-tight text-teal-mystic">
                {legendHover.label}
                <span className="text-[10px] font-normal text-white/60 ml-1.5">{legendHover.value}</span>
              </p>
              <p className="text-[10px] leading-snug text-zinc-300">{legendHover.definition}</p>
              <p className="text-[10px] leading-snug text-teal-mystic/70">{legendHover.implication}</p>
            </div>
          </div>
        );
      })()}
    </>
  );
}
