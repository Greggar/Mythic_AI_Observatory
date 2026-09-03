"use client";
import { useState } from "react";
import { detectContradiction } from "./StageDebate";
import type { TraceSession } from "@/types/trace";

interface RetrievedChunk {
  trace_id: string;
  content: string;
  relevance: number;
  used: boolean;
}

interface Props {
  trace?: TraceSession;
  traces?: TraceSession[];
}

const TRACE_COLORS = [
  "#34d399",
  "#a78bfa",
  "#fbbf24",
  "#60a5fa",
  "#f472b6",
  "#fb923c",
];

const AXES = [
  { key: "confidence", label: "Confidence" },
  { key: "relevance", label: "Context" },
  { key: "transparency", label: "Transparency" },
  { key: "adherence", label: "Constraint\nAdherence" },
  { key: "conflictAvoid", label: "Conflict\nAvoidance" },
  { key: "dataConstraints", label: "Data\nConstraints" },
  { key: "substance", label: "Output" },
] as const;

const EVASIVE_PAT = /\b(don't\s+\w*\s*have|cannot|unable|no\s+access|can't\s+\w*\s*(say|access)|not\s+(sure|able|designed|programmed|intended)|limitation|am\s+not|do\s+not\s+(store|retain|have))\b/i;

const HEDGING_PAT = /\b(it\s+depends|that\s+said|on\s+the\s+other\s+hand|however|although|generally\s+speaking|in\s+some\s+cases|it's?\s+worth\s+noting|to\s+a\s+certain\s+extent|more\s+or\s+less|somewhat|arguably|it's?\s+complex|it's?\s+complicated)\b/i;

const CONSTRAINT_PAT = /\b(as\s+of\s+my\s+last\s+update|my\s+knowledge\s+cutoff|I\s+don't\s+have\s+(real.time|access|browsing)|I\s+cannot\s+browse|based\s+on\s+my\s+training|to\s+the\s+best\s+of\s+my\s+knowledge|it\s+is\s+beyond\s+my|I\s+do\s+not\s+have\s+(real.time|access)|up\s+to\s+my\s+last\s+update)\b/i;

const N = AXES.length;
const ANGLE = (i: number) => (-Math.PI / 2) + (2 * Math.PI * i) / N;

function polar(cx: number, cy: number, r: number, i: number): [number, number] {
  const a = ANGLE(i);
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function computeValues(trace: TraceSession) {
  const confidence = trace.confidence ?? 0.5;

  const mrStep = trace.steps.find((s) => s.label === "Memory Retrieval");
  const chunks = mrStep?.metadata?.retrieved_chunks as RetrievedChunk[] | undefined;
  const relevance = chunks && chunks.length > 0
    ? chunks.reduce((s, c) => s + c.relevance, 0) / chunks.length
    : 0;

  const csStep = trace.steps.find((s) => s.label === "Context Assembly");
  const rgStep = trace.steps.find((s) => s.label === "Response Generation");
  const csOut = csStep?.metadata?.output as string | undefined;
  const rgOut = rgStep?.metadata?.output as string | undefined;
  const hasConflict = csOut && rgOut ? detectContradiction(csOut, rgOut) !== null : false;
  const adherence = hasConflict ? 0.3 : 1.0;

  const rg = rgOut || trace.output || "";
  if (!rg) return { confidence, relevance, transparency: 0.5, adherence, conflictAvoid: 0.5, dataConstraints: 0.5, substance: 0 };

  const wc = rg.split(/\s+/).filter(Boolean).length;
  const wcNorm = Math.max(wc / 40, 1);

  const evasiveMatches = (rg.match(EVASIVE_PAT) || []).length;
  const evasiveness = Math.min(evasiveMatches / wcNorm, 1);
  const transparency = 1 - evasiveness;

  const hedgingMatches = (rg.match(HEDGING_PAT) || []).length;
  const conflictAvoid = Math.min(hedgingMatches / wcNorm, 1);

  const constraintMatches = (rg.match(CONSTRAINT_PAT) || []).length;
  const dataConstraints = Math.min(constraintMatches / wcNorm, 1);

  const ol = trace.output?.length ?? 0;
  const substance = Math.min(ol / 500, 1);

  return { confidence, relevance, transparency, adherence, conflictAvoid, dataConstraints, substance };
}

const AXIS_DESCRIPTIONS: Record<string, string> = {
  transparency: "Inverse of self-limiting phrases (\"I cannot\", \"no access\") — higher = more direct",
  confidence: "Model's stated confidence in its own output (0–1)",
  relevance: "Mean similarity score of retrieved memory chunks — higher means more relevant context",
  adherence: "How closely the output follows its own synthesized context — drops when contradictions detected",
  conflictAvoid: "Rate of hedging/qualifying language (\"it depends\", \"however\") — higher = more evasive",
  dataConstraints: "Rate of boundary acknowledgment (\"as of my last update\", \"knowledge cutoff\") — higher = more constraint-aware",
  substance: "Output length normalized to 500 chars — higher means more substantive response",
};

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + "…" : id;
}

export default function TraceRadar({ trace, traces }: Props) {
  const [showLegend, setShowLegend] = useState(false);

  const traceList = traces && traces.length > 0 ? traces : (trace ? [trace] : []);
  const isComparative = traceList.length > 1;

  const allValues = traceList.map((t) => {
    const vals = computeValues(t);
    return AXES.map((a) => ({ ...a, value: vals[a.key] }));
  });

  const cx = 100;
  const cy = 95;
  const R = 70;
  const GRIDS = [0.2, 0.4, 0.6, 0.8, 1.0];

  return (
    <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-600">
          Trace Radar{isComparative ? ` (${traceList.length})` : ""}
        </div>
        <button
          onClick={() => setShowLegend((p) => !p)}
          className="text-[8px] font-mono text-zinc-600 hover:text-teal-mystic/60 transition-colors"
        >
          {showLegend ? "Hide" : "?"}
        </button>
      </div>

      {/* Fingerprint summary for comparative mode */}
      {isComparative && (
        <div className="mb-2 space-y-1">
          {allValues.map((data, ti) => (
            <div key={ti} className="flex items-center gap-1.5 text-[7px] font-mono leading-tight">
              <span
                className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
                style={{ backgroundColor: TRACE_COLORS[ti % TRACE_COLORS.length] }}
              />
              <span className="text-zinc-500 w-[52px] truncate" title={traceList[ti].id}>
                {shortId(traceList[ti].id)}
              </span>
              {data.map((d) => {
                const pct = Math.round(d.value * 100);
                const bg = pct >= 70 ? "bg-emerald-500/20 text-emerald-400"
                  : pct >= 40 ? "bg-amber-500/15 text-amber-400"
                  : "bg-red-500/15 text-red-400";
                return (
                  <span
                    key={d.key}
                    className={`px-1 py-0.5 rounded ${bg}`}
                    title={`${d.label}: ${pct}%`}
                  >
                    {pct}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <svg
        viewBox="0 0 200 190"
        className="w-full h-auto"
        style={{ maxHeight: 175 }}
      >
        {/* Grid — concentric pentagons */}
        {GRIDS.map((level) => {
          const pts = Array.from({ length: N }, (_, i) => polar(cx, cy, R * level, i));
          return (
            <polygon
              key={level}
              points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={level === 1 ? 0.5 : 0.3}
            />
          );
        })}

        {/* Axis lines */}
        {Array.from({ length: N }, (_, i) => {
          const [x, y] = polar(cx, cy, R, i);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={0.5}
            />
          );
        })}

        {/* Data polygons — one per trace */}
        {allValues.map((data, ti) => {
          const color = isComparative
            ? TRACE_COLORS[ti % TRACE_COLORS.length]
            : "rgba(139, 92, 246, 0.5)";
          const fillColor = isComparative
            ? `${TRACE_COLORS[ti % TRACE_COLORS.length]}15`
            : "rgba(139, 92, 246, 0.15)";
          const dotFill = isComparative
            ? TRACE_COLORS[ti % TRACE_COLORS.length]
            : "rgba(139, 92, 246, 0.7)";
          const dataPoints = data.map((d, i) => polar(cx, cy, R * d.value, i));
          return (
            <g key={ti}>
              <polygon
                points={dataPoints.map(([x, y]) => `${x},${y}`).join(" ")}
                fill={fillColor}
                stroke={color}
                strokeWidth={isComparative ? 1.2 : 1.5}
                strokeLinejoin="round"
              />
              {dataPoints.map(([x, y], i) => (
                <circle
                  key={i}
                  cx={x} cy={y} r={isComparative ? 2.5 : 3}
                  fill={dotFill}
                  stroke="#1a1a2e"
                  strokeWidth={isComparative ? 0.8 : 1}
                />
              ))}
            </g>
          );
        })}

        {/* Center dot */}
        <circle cx={cx} cy={cy} r={1.5} fill="rgba(255,255,255,0.15)" />

        {/* Axis labels */}
        {AXES.map((d, i) => {
          const [x, y] = polar(cx, cy, R + 18, i);
          const lines = d.label.split("\n");
          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-zinc-500"
              fontSize="8"
              fontFamily="ui-monospace, monospace"
            >
              {lines.map((line, li) => (
                <tspan key={li} x={x} dy={li === 0 ? 0 : 9}>{line}</tspan>
              ))}
            </text>
          );
        })}
      </svg>

      {/* Legend */}
      {isComparative && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {traceList.map((t, ti) => {
            const color = TRACE_COLORS[ti % TRACE_COLORS.length];
            return (
              <div key={ti} className="flex items-center gap-1 text-[8px] font-mono text-zinc-500">
                <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ backgroundColor: color }} />
                <span className="truncate max-w-[100px]" title={t.id}>{shortId(t.id)}</span>
                <span className="text-zinc-600">{t.model_used?.split(":")[0] || "?"}</span>
              </div>
            );
          })}
        </div>
      )}

      {showLegend && (
        <div className="mt-2 space-y-1.5 border-t border-white/[0.04] pt-2">
          {AXES.map((d) => (
            <div key={d.key} className="text-[8px] text-zinc-500 leading-tight">
              <span className="font-semibold text-zinc-400">{d.label.replace("\n", " ")}</span>
              {" — "}{AXIS_DESCRIPTIONS[d.key]}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
