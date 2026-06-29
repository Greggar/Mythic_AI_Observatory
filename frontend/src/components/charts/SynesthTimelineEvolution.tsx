"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

// ── Ring definitions (mirrors SynesthCorrelationHeatmap) ──
const RING_SPEC = [
  { name: "Depth", size: 3 },
  { name: "Mood", size: 5 },
  { name: "Syntax", size: 3 },
  { name: "Action", size: 3 },
  { name: "Tone", size: 6 },
  { name: "Form", size: 4 },
];

const RING_LABELS = [
  ["Interjection", "Minor Sentence", "Full Verb Phrase"],
  ["Imperative", "Indicative", "Interrogative", "Conditional", "Subjunctive"],
  ["Simple", "Compound", "Complex"],
  ["Direct Execution", "Conversational Phatic", "Refusal/Guardrail"],
  ["Informative", "Instructional", "Entertainment", "Creative", "Analytical", "Corrective"],
  ["Structured (Code/Tables)", "Bulleted/Fragmented", "Continuous Prose", "Verse"],
];

const RING_COLORS = [
  ["#f472b6", "#fbbf24", "#a78bfa"],
  ["#ef4444", "#3b82f6", "#f59e0b", "#8b5cf6", "#10b981"],
  ["#34d399", "#f97316", "#f472b6"],
  ["#06b6d4", "#f59e0b", "#ef4444"],
  ["#6366f1", "#22c55e", "#fcd34d", "#ec4899", "#f97316", "#8b5cf6"],
  ["#a855f7", "#eab308", "#34d399", "#f472b6"],
];

// ── Client-side classifiers (self-contained) ──
function classifyDepth(text: string): number {
  if (/^(Oh|Wow|Please|Ah|Hey|Alas|Ooh|Aha|Oops|Ugh|Yay|Hmm|Well)\b/i.test(text)) return 0;
  if (/\b(Hello|Hi|Yes|No|Thanks|Okay|Sure|Goodbye|Bye|Great|Fine)\b/i.test(text) && text.split(" ").length <= 3) return 1;
  return 2;
}

function classifyMood5(text: string): number {
  if (/^[A-Z][a-z]+/.test(text) || /^(The|This|That|There|It|We|They|He|She|I)\b/i.test(text)) return 1;
  if (/\?\s*$/.test(text) || /^(What|How|Why|When|Where|Who|Which|Whom|Whose)\b/i.test(text)) return 2;
  if (/^(If|When|Whenever|Should|Unless|Provided that|Assuming|Given that)\b/i.test(text)) return 3;
  if (/^(Act as|Imagine|Pretend|Suppose|Picture|Consider what if|What would|What if)\b/i.test(text)) return 4;
  return 0;
}

function classifySyntax(text: string): number {
  const hasComplex = /\b(because|although|while|since|unless|if|when|whereas|though|whereas)\b/i.test(text);
  const hasCompound = /\b(and|but|or|yet|so|for|nor)\b/i.test(text);
  if (hasComplex) return 2;
  if (hasCompound) return 1;
  return 0;
}

function classifyActionType(text: string): number {
  if (/^(Sure|Okay|Of course|Certainly|Yes|Here'[ds]|Here is|Here are|I'll|Let me|I can|I will)\b/i.test(text) || text.length < 30 || /```/.test(text)) return 0;
  if (/^(I'm sorry|I cannot|I can't|As an AI|I don't have|I apologize|Unable to|Cannot fulfill|Cannot provide|I must|I should not)\b/i.test(text)) return 2;
  return 1;
}

function classifyPragmaticTone(text: string): number {
  if (/\b(step|follow|instructions|how to|guide|tutorial|walkthrough|do this|first|next|then|finally|procedure|process)\b/i.test(text)) return 1;
  if (/\b(joke|humor|funny|silly|amusing|hilarious|playful|limerick|light[- ]hearted)\b/i.test(text)) return 2;
  if (/\b(metaphor|imagine|evocative|vivid|story|poem|poetic|beautiful|art|artistic|aesthetic|mood|atmosphere|shadow|light|breathtaking|sublime|dream|surreal)\b/i.test(text)) return 3;
  if (/\b(however|therefore|thus|consequently|furthermore|analysis|analyze|examine|compare|contrast|perspective|lens|dimension|factor|parameter|framework|paradigm)\b/i.test(text)) return 4;
  if (/\b(warning|caution|careful|critical|you should|you need to|make sure|ensure|remember to|must|should not|incorrect|wrong|mistake|error|flaw|issue|problem|never)\b/i.test(text)) return 5;
  return 0;
}

function classifyOutputForm(text: string): number {
  if (/```/.test(text) || /\|.+\|/.test(text) || /^#\s/m.test(text)) return 0;
  if (/^[-*]\s/m.test(text) || /^\d+\.\s/m.test(text)) return 1;
  if (text.split("\n").length >= 3 && text.split("\n").every(l => l.length < 55) && text.split("\n").every(l => l.length < 80)) return 3;
  return 2;
}

// ── Helpers ──
function classifyRing(text: string, ringIdx: number): number {
  switch (ringIdx) {
    case 0: return classifyDepth(text);
    case 1: return classifyMood5(text);
    case 2: return classifySyntax(text);
    case 3: return classifyActionType(text);
    case 4: return classifyPragmaticTone(text);
    case 5: return classifyOutputForm(text);
    default: return 0;
  }
}

// Format date label (e.g., "Jun 1")
function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface Bucket {
  label: string;
  ts: number;
  start: Date;
  counts: number[][]; // counts[ringIdx][catIdx]
  total: number;      // total traces in bucket
}

interface Props {
  traces: { id: string; prompt: string; output: string | null; created_at?: string }[];
}

export default function SynesthTimelineEvolution({ traces }: Props) {
  const [ringIdx, setRingIdx] = useState(0);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null);

  // ── Bucket traces by week ──
  const buckets = useMemo<Bucket[]>(() => {
    const dated = traces
      .filter((t) => t.created_at && t.output)
      .map((t) => ({ t, date: new Date(t.created_at!) }))
      .filter(({ date }) => !isNaN(date.getTime()))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (dated.length < 2) return [];

    // Auto-detect bucket size
    const spanMs = dated[dated.length - 1].date.getTime() - dated[0].date.getTime();
    const spanDays = spanMs / (1000 * 60 * 60 * 24);
    const bucketDays = spanDays < 14 ? 1 : spanDays < 90 ? 7 : 30;

    // Group by bucket
    const bucketMap = new Map<string, typeof dated>();
    for (const d of dated) {
      const bucketStart = new Date(d.date);
      if (bucketDays === 1) {
        bucketStart.setHours(0, 0, 0, 0);
      } else {
        // Round to nearest bucket boundary going backward
        const dayOfWeek = bucketStart.getDay();
        const diff = dayOfWeek === 0 ? 0 : dayOfWeek;
        bucketStart.setDate(bucketStart.getDate() - diff);
        bucketStart.setHours(0, 0, 0, 0);
      }
      const key = bucketStart.toISOString().slice(0, 10);
      if (!bucketMap.has(key)) bucketMap.set(key, []);
      bucketMap.get(key)!.push(d);
    }

    const arr = Array.from(bucketMap.entries())
      .map(([key, items]) => {
        const start = new Date(key);
        const counts = RING_SPEC.map((r) => new Array(r.size).fill(0));
        for (const { t } of items) {
          for (let ri = 0; ri < RING_SPEC.length; ri++) {
            const cat = classifyRing(t.prompt, ri);
            counts[ri][cat] = (counts[ri][cat] || 0) + 1;
          }
        }
        return {
          label: fmtDate(start),
          ts: start.getTime(),
          start,
          counts,
          total: items.length,
        };
      })
      .sort((a, b) => a.ts - b.ts);

    return arr;
  }, [traces]);

  // ── SVG dimensions ──
  const W = 480;
  const H = 260;
  const M = { top: 18, right: 20, bottom: 42, left: 50 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const svgRef = typeof window !== "undefined" ? { current: null as SVGSVGElement | null } : { current: null };

  // ── Build stacked area paths for selected ring ──
  const areaPaths = useMemo(() => {
    if (buckets.length < 2) return null;

    const spec = RING_SPEC[ringIdx];
    const nCats = spec.size;
    const colors = RING_COLORS[ringIdx];
    const nBuckets = buckets.length;

    // x positions
    const xs = buckets.map((_, i) => M.left + (i + 0.5) * (plotW / nBuckets));

    // Cumulative percentages per bucket
    const cumStacks: number[][] = []; // cumStacks[bucketIdx][catIdx] = cumulative %
    for (let bi = 0; bi < nBuckets; bi++) {
      const total = buckets[bi].total || 1;
      let cum = 0;
      const row: number[] = [];
      for (let ci = 0; ci < nCats; ci++) {
        cum += (buckets[bi].counts[ringIdx][ci] / total) * 100;
        row.push(cum);
      }
      cumStacks.push(row);
    }

    function yVal(pct: number): number {
      return M.top + plotH * (1 - pct / 100);
    }

    // Build path for each category
    const paths = [];
    for (let ci = 0; ci < nCats; ci++) {
      const bottomPct: number[] = ci === 0 ? new Array(nBuckets).fill(0) : cumStacks.map((r) => r[ci - 1]);
      const topPct: number[] = cumStacks.map((r) => r[ci]);

      // Path goes forward over top, then backward over bottom
      let d = "";
      // Start at bottom-left of first bucket
      d += `M ${xs[0]} ${yVal(0)}`;
      // Forward: line to top of first bucket, then curve through subsequent buckets
      d += `L ${xs[0]} ${yVal(topPct[0])}`;
      for (let bi = 1; bi < nBuckets; bi++) {
        const xc = (xs[bi - 1] + xs[bi]) / 2;
        d += `C ${xc} ${yVal(topPct[bi - 1])}, ${xc} ${yVal(topPct[bi])}, ${xs[bi]} ${yVal(topPct[bi])}`;
      }
      // Backward: across the bottom
      for (let bi = nBuckets - 1; bi >= 0; bi--) {
        const bottom = ci === 0 ? 0 : bottomPct[bi];
        if (bi === nBuckets - 1) {
          d += `L ${xs[bi]} ${yVal(bottom)}`;
        } else {
          const xc = (xs[bi] + xs[bi + 1]) / 2;
          d += `C ${xc} ${yVal(bottom)}, ${xc} ${yVal(ci === 0 ? 0 : bottomPct[bi + 1])}, ${xs[bi]} ${yVal(bottom)}`;
        }
      }
      d += "Z";

      paths.push({ d, color: colors[ci], label: RING_LABELS[ringIdx][ci] });
    }

    return { xs, paths, nBuckets, nCats, colors, labels: RING_LABELS[ringIdx] };
  }, [buckets, ringIdx, M, plotW, plotH]);

  // ── Y-axis ticks (0%, 25%, 50%, 75%, 100%) ──
  const yTicks = [0, 25, 50, 75, 100];

  if (buckets.length < 2) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: "180px" }}>
        <span className="text-[10px] font-mono text-zinc-600">
          Need at least 2 time-bucketed traces — try a different model or mode
        </span>
      </div>
    );
  }

  const totalTraces = buckets.reduce((s, b) => s + b.total, 0);

  return (
    <div className="space-y-2">
      {/* Ring selector + summary */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold tracking-widest uppercase text-zinc-500">Ring</span>
          <div className="flex gap-0.5">
            {RING_SPEC.map((r, i) => (
              <button
                key={r.name}
                onClick={() => setRingIdx(i)}
                className={`px-2 py-0.5 text-[9px] font-mono rounded transition-colors ${
                  i === ringIdx
                    ? "bg-teal-mystic/20 text-teal-mystic"
                    : "text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.04]"
                }`}
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
        <div className="text-[8px] font-mono text-zinc-600">
          <span className="text-zinc-500">{totalTraces}</span> traces · <span className="text-zinc-500">{buckets.length}</span> {buckets.length === 1 ? "bucket" : "buckets"}
        </div>
      </div>

      {/* SVG chart */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ aspectRatio: `${W}/${H}`, overflow: "hidden" }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Y-axis grid lines + labels */}
        {yTicks.map((pct) => {
          const y = M.top + plotH * (1 - pct / 100);
          return (
            <g key={pct}>
              <line
                x1={M.left} y1={y} x2={M.left + plotW} y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={0.5}
              />
              <text
                x={M.left - 6} y={y + 3}
                textAnchor="end"
                className="fill-zinc-600 text-[8px] font-mono"
              >
                {pct}%
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {areaPaths && areaPaths.xs.length <= 20 && areaPaths.xs.map((x, i) => (
          <text
            key={i}
            x={x} y={H - M.bottom + 14}
            textAnchor="middle"
            className="fill-zinc-600 text-[8px] font-mono"
          >
            {buckets[i].label}
          </text>
        ))}
        {areaPaths && areaPaths.xs.length > 20 && (
          // Show every Nth label to avoid crowding
          (() => {
            const step = Math.ceil(areaPaths.xs.length / 10);
            return areaPaths.xs.map((x, i) => {
              if (i % step !== 0 && i !== areaPaths.xs.length - 1) return null;
              return (
                <text
                  key={i}
                  x={x} y={H - M.bottom + 14}
                  textAnchor="middle"
                  className="fill-zinc-600 text-[8px] font-mono"
                >
                  {buckets[i].label}
                </text>
              );
            });
          })()
        )}

        {/* Stacked areas */}
        {areaPaths && areaPaths.paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill={p.color}
            fillOpacity={0.55 + 0.15 * (1 - i / areaPaths.nCats)}
            stroke={p.color}
            strokeWidth={0.5}
            strokeOpacity={0.5}
            className="transition-opacity duration-200"
            onMouseEnter={(e) => {
              const bbox = (e.target as SVGElement).closest("svg")?.getBoundingClientRect();
              if (!bbox) return;
              const x = e.clientX;
              const y = e.clientY;
              // Find nearest bucket
              const cx = (e.nativeEvent as MouseEvent).offsetX;
              const bi = areaPaths.xs.reduce((best, xv, idx) =>
                Math.abs(xv - cx) < Math.abs(areaPaths.xs[best] - cx) ? idx : best, 0);
              const pct = ((buckets[bi].counts[ringIdx][i] / buckets[bi].total) * 100).toFixed(1);
              setTooltip({
                x,
                y,
                lines: [
                  `${RING_LABELS[ringIdx][i]}: ${pct}%`,
                  `${buckets[bi].label} · ${buckets[bi].total} traces`,
                ],
              });
            }}
            onMouseMove={(e) => {
              setTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : prev);
            }}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}

        {/* Bottom axis line */}
        <line
          x1={M.left} y1={M.top + plotH} x2={M.left + plotW} y2={M.top + plotH}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={0.5}
        />
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {areaPaths && areaPaths.labels.map((label, i) => (
          <div key={label} className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: areaPaths.colors[i] }}
            />
            <span className="text-[8px] font-mono text-zinc-500">{label}</span>
          </div>
        ))}
      </div>

      {/* Tooltip portal */}
      {tooltip && createPortal(
        <div
          className="fixed z-[100] pointer-events-none bg-black/80 backdrop-blur-md border border-white/[0.08] rounded-lg px-3 py-2 shadow-xl"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}
        >
          {tooltip.lines.map((line, i) => (
            <div key={i} className={`text-[10px] font-mono ${i === 0 ? "text-zinc-200" : "text-zinc-500"}`}>
              {line}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
