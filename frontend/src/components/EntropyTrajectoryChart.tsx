"use client";

import { useMemo, useId, useState } from "react";
import { createPortal } from "react-dom";
import type { TokenEntropy } from "@/types/trace";
import ResearchPopover from "./ResearchPopover";

interface Props {
  entropy: TokenEntropy;
  output?: string;
}

const W = 560;
const H = 150;
const PAD = { l: 38, r: 14, t: 14, b: 22 };

export default function EntropyTrajectoryChart({ entropy, output }: Props) {
  const [hover, setHover] = useState<{ x: number; y: number; idx: number; val: number } | null>(null);
  const gradId = useId();

  const { series, branching, medianBranch, stats, maxIdx } = useMemo(() => {
    const raw = Array.isArray(entropy.series) && entropy.series.length >= 2 ? entropy.series : null;
    if (!raw) {
      return {
        series: null,
        branching: null,
        medianBranch: entropy.median_branching ?? 1,
        stats: {
          mean: entropy.mean_entropy,
          p95: entropy.p95_entropy,
          max: entropy.mean_entropy,
          maxIdx: 0,
        },
        maxIdx: 0,
      };
    }
    const max = Math.max(...raw);
    const maxIdx = raw.indexOf(max);
    const br =
      Array.isArray(entropy.branching_series) && entropy.branching_series.length === raw.length
        ? entropy.branching_series
        : raw.map((v) => Math.pow(2, v));
    const sorted = [...br].sort((a, b) => a - b);
    const med = entropy.median_branching ?? sorted[Math.floor(sorted.length / 2)];
    return {
      series: raw,
      branching: br,
      medianBranch: med,
      stats: { mean: entropy.mean_entropy, p95: entropy.p95_entropy, max, maxIdx },
      maxIdx,
    };
  }, [entropy]);

  if (!series) {
    return (
      <div className="text-[10px] font-mono text-zinc-600">
        mean {entropy.mean_entropy?.toFixed(3) ?? "—"} bits — no full series captured
        (logprobs node required)
      </div>
    );
  }

  const n = series.length;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const maxV = stats.max || 0.001;
  const maxY = Math.min(4, Math.max(1.5, maxV * 1.25));

  const xFor = (i: number) => PAD.l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yFor = (v: number) => PAD.t + plotH - (v / maxY) * plotH;

  const linePath = series.map((v, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${xFor(n - 1).toFixed(1)},${yFor(0)} L${xFor(0).toFixed(1)},${yFor(0)} Z`;
  const meanY = yFor(Math.min(stats.mean ?? 0, maxY));
  const p95Y = stats.p95 != null ? yFor(Math.min(stats.p95, maxY)) : null;

  // Branching fan: the stream "splits" at high-uncertainty tokens. Half-width at
  // token i grows with (2**H_i − 1); deterministic tokens (2**H ≈ 1) collapse to a
  // single thread around the mean line.
  const maxBranch = branching ? Math.max(...branching) : 1;
  const branchScale = branching ? (plotH * 0.32) / Math.max(1, maxBranch - 1) : 0;
  const halfWidths = branching
    ? branching.map((b) => Math.min(branchScale * (b - 1), plotH / 2))
    : [];
  const fanTop = halfWidths
    .map((hw, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${(meanY - hw).toFixed(1)}`)
    .join(" ");
  const fanBottom = [...halfWidths]
    .reverse()
    .map((hw, i) => {
      const idx = halfWidths.length - 1 - i;
      return `L${xFor(idx).toFixed(1)},${(meanY + hw).toFixed(1)}`;
    })
    .join(" ");
  const fanPath = halfWidths.length ? `${fanTop} ${fanBottom} Z` : null;

  // Second axis: which character of the output is the peak at?
  const peakFrac = n > 1 ? maxIdx / (n - 1) : 0.5;
  const outputLen = output?.length ?? 0;
  const peakChar = Math.round(peakFrac * outputLen);
  const peakWord = output ? output.slice(0, peakChar).trimEnd().split(/\s+/).pop() ?? "" : "";

  const gridVals = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 2.5, 3.0].filter((v) => v <= maxY);

  return (
    <div className="space-y-1.5">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Entropy over the generation">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5eead4" stopOpacity="0.12" />
            <stop offset="50%" stopColor="#5eead4" stopOpacity="0.03" />
            <stop offset="100%" stopColor="#5eead4" stopOpacity="0.12" />
          </linearGradient>
        </defs>

        {/* Gridlines */}
        {gridVals.map((v) => (
          <g key={v}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="#ffffff"
              strokeOpacity={0.05}
              strokeWidth={0.6}
            />
            <text
              x={PAD.l - 5}
              y={yFor(v) + 2.5}
              textAnchor="end"
              fill="#3f3f46"
              fontSize={7.5}
              fontFamily="ui-monospace, monospace"
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        <text x={4} y={12} fill="#3f3f46" fontSize={7.5} fontFamily="ui-monospace, monospace">
          H (bits)
        </text>

        {/* Branching fan — stream splits at high-uncertainty tokens */}
        {fanPath && <path d={fanPath} fill={`url(#${gradId})`} />}

        {/* Area + line */}
        <path d={areaPath} fill="#a78bfa" fillOpacity={0.1} />
        <path
          d={linePath}
          fill="none"
          stroke="#a78bfa"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Mean + p95 reference lines */}
        <line x1={PAD.l} x2={W - PAD.r} y1={meanY} y2={meanY} stroke="#a78bfa" strokeOpacity={0.4} strokeWidth={0.8} strokeDasharray="4 3" />
        {p95Y != null && (
          <line x1={PAD.l} x2={W - PAD.r} y1={p95Y} y2={p95Y} stroke="#f59e0b" strokeOpacity={0.35} strokeWidth={0.8} strokeDasharray="2 3" />
        )}

        {/* Peak marker */}
        <circle cx={xFor(maxIdx)} cy={yFor(stats.max)} r={3.5} fill="#fbbf24" stroke="#0a0a0a" strokeWidth={1} />
        <line
          x1={xFor(maxIdx)}
          x2={xFor(maxIdx)}
          y1={yFor(stats.max)}
          y2={H - PAD.b}
          stroke="#fbbf24"
          strokeOpacity={0.25}
          strokeWidth={0.8}
          strokeDasharray="2 3"
        />

        {/* X axis label */}
        <text x={W - PAD.r} y={H - 8} textAnchor="end" fill="#3f3f46" fontSize={7.5} fontFamily="ui-monospace, monospace">
          token 0 → {n - 1}
        </text>

        {/* Hover — vertical guide + dots */}
        {hover && (
          <g>
            <line
              x1={xFor(hover.idx)}
              x2={xFor(hover.idx)}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke="#e4e4e7"
              strokeOpacity={0.25}
              strokeWidth={0.8}
            />
            <circle cx={xFor(hover.idx)} cy={yFor(hover.val)} r={3} fill="#e4e4e7" />
          </g>
        )}

        {/* Invisible hover targets */}
        {series.map((v, i) => (
          <rect
            key={i}
            x={xFor(i) - 3}
            y={PAD.t}
            width={6}
            height={plotH}
            fill="transparent"
            onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, idx: i, val: v })}
            onMouseMove={(e) => setHover((h) => (h?.idx === i ? { ...h, x: e.clientX, y: e.clientY } : h))}
            onMouseLeave={() => setHover((h) => (h?.idx === i ? null : h))}
          />
        ))}
      </svg>

      <div className="flex items-center gap-3 text-[9px] font-mono">
        <span className="text-zinc-500">
          peak <span className="text-amber-400">H {stats.max.toFixed(3)}</span> @ token {maxIdx}
          {peakWord && (
            <span className="text-zinc-600"> · around “{peakWord}”</span>
          )}
        </span>
        <span className="text-zinc-600">·</span>
        <span className="text-violet-400/80">mean {stats.mean?.toFixed(3)}</span>
        <span className="text-zinc-600">·</span>
        <span className="text-amber-500/70">p95 {stats.p95?.toFixed(3)}</span>
        <span className="text-zinc-600">·</span>
        <span className="text-teal-400/80">2^H med {medianBranch.toFixed(2)}</span>
        <span className="text-zinc-600">·</span>
        <span className="text-zinc-500">n={n}</span>
        <span className="text-zinc-600 ml-auto" title="fan width grows with 2^H = live competing continuations">
          fan ∝ 2^H
        </span>
        <ResearchPopover refKey="token-entropy" />
      </div>

      {hover && typeof document !== "undefined" && (
        createPortal(
          <div
            className="fixed z-[100] pointer-events-none glass-panel p-2.5 space-y-0.5"
            style={{ left: Math.min(hover.x + 12, window.innerWidth - 220), top: Math.min(hover.y + 12, window.innerHeight - 90) }}
          >
            <div className="text-[9px] font-mono text-zinc-300">
              token {hover.idx} / {n - 1}
            </div>
            <div className="text-[10px] font-mono text-amber-400">H {hover.val.toFixed(4)} bits</div>
            {branching && (
              <div className="text-[9px] font-mono text-teal-400/80">
                2^H {branching[hover.idx].toFixed(3)} live continuations
              </div>
            )}
            <div className="text-[8px] font-mono text-zinc-600">
              {hover.idx === maxIdx ? "← peak uncertainty" : hover.val > (stats.mean ?? 0) * 1.5 ? "above mean" : "around mean"}
            </div>
          </div>,
          document.body
        )
      )}
    </div>
  );
}
