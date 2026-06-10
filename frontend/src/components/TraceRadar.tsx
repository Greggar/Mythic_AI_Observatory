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
  trace: TraceSession;
}

const AXES = [
  { key: "confidence", label: "Confidence" },
  { key: "relevance", label: "Context" },
  { key: "adherence", label: "Constraint\nAdherence" },
  { key: "substance", label: "Output" },
  { key: "honesty", label: "Honesty" },
] as const;

const HONESTY_PAT = /\b(don't\s+\w*\s*have|cannot|unable|no\s+access|can't\s+\w*\s*(say|access)|not\s+(sure|able|designed|programmed|intended)|limitation|am\s+not|do\s+not\s+(store|retain|have))\b/i;

const N = AXES.length;
const ANGLE = (i: number) => (-Math.PI / 2) + (2 * Math.PI * i) / N;

function polar(cx: number, cy: number, r: number, i: number): [number, number] {
  const a = ANGLE(i);
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function computeValues(trace: TraceSession) {
  const confidence = trace.confidence ?? 0.5;

  // Context Relevance — mean chunk relevance
  const mrStep = trace.steps.find((s) => s.label === "Memory Retrieval");
  const chunks = mrStep?.metadata?.retrieved_chunks as RetrievedChunk[] | undefined;
  const relevance = chunks && chunks.length > 0
    ? chunks.reduce((s, c) => s + c.relevance, 0) / chunks.length
    : 0;

  // Constraint Adherence — inverse of contradiction
  const csStep = trace.steps.find((s) => s.label === "Context Synthesis");
  const rgStep = trace.steps.find((s) => s.label === "Response Generation");
  const csOut = csStep?.metadata?.output as string | undefined;
  const rgOut = rgStep?.metadata?.output as string | undefined;
  const hasConflict = csOut && rgOut ? detectContradiction(csOut, rgOut) !== null : false;
  const adherence = hasConflict ? 0.3 : 1.0;

  // Output Substance — length-based
  const ol = trace.output?.length ?? 0;
  const substance = Math.min(ol / 500, 1);

  // Honesty Markers — ratio of honesty signals to total words
  const rg = rgOut || trace.output || "";
  if (!rg) return { confidence, relevance: 0, adherence, substance, honesty: 0.5 };
  const matches = (rg.match(HONESTY_PAT) || []).length;
  const wc = rg.split(/\s+/).filter(Boolean).length;
  const honesty = Math.min(matches / Math.max(wc / 40, 1), 1);

  return { confidence, relevance, adherence, substance, honesty };
}

type Values = Record<string, number>;

const AXIS_DESCRIPTIONS: Record<string, string> = {
  honesty: "Rate of self-limiting phrases (\"I cannot\", \"no access\") — higher means more disclaimers",
  confidence: "Model's stated confidence in its own output (0–1)",
  relevance: "Mean similarity score of retrieved memory chunks — higher means more relevant context",
  adherence: "How closely the output follows its own synthesized context — drops when contradictions detected",
  substance: "Output length normalized to 500 chars — higher means more substantive response",
};

export default function TraceRadar({ trace }: Props) {
  const [showLegend, setShowLegend] = useState(false);
  const vals = computeValues(trace);
  const data = AXES.map((a) => ({ ...a, value: vals[a.key] }));

  const cx = 100;
  const cy = 95;
  const R = 70;
  const GRIDS = [0.2, 0.4, 0.6, 0.8, 1.0];

  const dataPoints = data.map((d, i) => polar(cx, cy, R * d.value, i));

  return (
    <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-600">
          Trace Radar
        </div>
        <button
          onClick={() => setShowLegend((p) => !p)}
          className="text-[8px] font-mono text-zinc-600 hover:text-teal-mystic/60 transition-colors"
        >
          {showLegend ? "Hide" : "?"}
        </button>
      </div>
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

        {/* Data polygon */}
        <polygon
          points={dataPoints.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="rgba(139, 92, 246, 0.15)"
          stroke="rgba(139, 92, 246, 0.5)"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* Data points */}
        {dataPoints.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={3} fill="rgba(139, 92, 246, 0.7)" stroke="#1a1a2e" strokeWidth={1} />
        ))}

        {/* Center dot */}
        <circle cx={cx} cy={cy} r={1.5} fill="rgba(255,255,255,0.15)" />

        {/* Axis labels */}
        {data.map((d, i) => {
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

        {/* Value tags — small numbers next to each data point */}
        {data.map((d, i) => {
          const [x, y] = dataPoints[i];
          const labelAngle = ANGLE(i);
          const tx = x + 10 * Math.cos(labelAngle);
          const ty = y + 10 * Math.sin(labelAngle);
          return (
            <text
              key={i}
              x={tx}
              y={ty}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-zinc-400"
              fontSize="8"
              fontFamily="ui-monospace, monospace"
            >
              {d.value.toFixed(2)}
            </text>
          );
        })}
      </svg>

      {showLegend && (
        <div className="mt-2 space-y-1.5 border-t border-white/[0.04] pt-2">
          {data.map((d) => (
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
