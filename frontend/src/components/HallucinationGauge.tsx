"use client";
import { useMemo, useRef, useState } from "react";
import type { TraceSession } from "@/types/trace";
import { detectContradiction } from "./StageDebate";
import { createPortal } from "react-dom";

interface RetrievedChunk {
  trace_id: string;
  content: string;
  relevance: number;
  used: boolean;
}

interface Signal {
  key: string;
  label: string;
  value: number;
  max: number;
  score: number;
  detail: string;
  color: string;
}

interface IntentProb {
  label: string;
  confidence: number;
}

const EVASIVE_PAT = /\b(don't\s+\w*\s*have|cannot|unable|no\s+access|can't\s+\w*\s*(say|access)|not\s+(sure|able|designed|programmed|intended)|limitation|am\s+not|do\s+not\s+(store|retain|have))\b/i;
const HEDGING_PAT = /\b(it\s+depends|that\s+said|on\s+the\s+other\s+hand|however|although|generally\s+speaking|in\s+some\s+cases|it's?\s+worth\s+noting|to\s+a\s+certain\s+extent|more\s+or\s+less|somewhat|arguably|it's?\s+complex|it's?\s+complicated)\b/i;
const REFUSAL_PAT = /\b(i'?m\s+(not\s+able|unable)|i\s+can'?t\s+(provide|locate|find|confirm|verify|say)|i\s+cannot\s+(provide|locate|find|confirm|verify|say)|no\s+(information|data|record|evidence|mention|reference)|does\s+not\s+(exist|appear|seem)|not\s+(a\s+real|aware\s+of)|fabricated|made\s+up|couldn'?t\s+(find|locate|verify))\b/i;

function computeRisk(trace: TraceSession): { signals: Signal[]; total: number; level: string; levelColor: string; isCorrectRefusal: boolean } {
  const signals: Signal[] = [];
  const output = trace.output || "";
  const wc = output.split(/\s+/).filter(Boolean).length || 1;
  const ddcP = trace.ddc?.prompt;
  const ddcR = trace.ddc?.response;
  const lccP = trace.lcc?.prompt;
  const lccR = trace.lcc?.response;

  // Detect hallucination probe + correct refusal
  const intentStep = trace.steps.find((s) => s.label === "Intent Classification");
  const probs = intentStep?.metadata?.intent_probs as IntentProb[] | undefined;
  const isProbe = Array.isArray(probs) && probs.some((p) => p.label === "hallucination_probe");
  const isRefusal = REFUSAL_PAT.test(output);
  const isCorrectRefusal = isProbe && isRefusal;

  // 1. Classification Certainty (0-25): inverted avg of DDC + LCC scores
  let certaintyScore = 0.5;
  let certaintyN = 0;
  if (ddcP?.score != null) { certaintyScore += ddcP.score; certaintyN++; }
  if (ddcR?.score != null) { certaintyScore += ddcR.score; certaintyN++; }
  if (lccP?.score != null) { certaintyScore += lccP.score; certaintyN++; }
  if (lccR?.score != null) { certaintyScore += lccR.score; certaintyN++; }
  const avgCertainty = certaintyN > 0 ? certaintyScore / (certaintyN + 1) + 0.05 : 0.5;
  const certaintyRisk = Math.round((1 - Math.min(avgCertainty / 0.35, 1)) * 25);
  const certaintyAvgDisplay = ((avgCertainty * 100).toFixed(0));
  signals.push({
    key: "certainty", label: "Low Classification Certainty", value: certaintyRisk, max: 25,
    score: Math.round(avgCertainty * 100),
    detail: `Mean embedding score ${certaintyAvgDisplay}%`,
    color: "#60a5fa",
  });

  // 2. Domain Drift (0-20): DDC main class mismatch
  let driftScore = 0;
  const driftDetail: string[] = [];
  if (ddcP?.code && ddcR?.code && ddcP.code[0] !== ddcR.code[0]) {
    driftScore = 20;
    driftDetail.push(`DDC prompt ${ddcP.code[0]}xx → response ${ddcR.code[0]}xx`);
  }
  if (lccP?.code && lccR?.code && lccP.code[0] !== lccR.code[0]) {
    driftScore = Math.max(driftScore, 15);
    driftDetail.push(`LCC prompt ${lccP.code[0]} → response ${lccR.code[0]}`);
  }
  signals.push({
    key: "drift", label: "Domain Drift", value: driftScore, max: 20,
    score: driftScore,
    detail: driftDetail.length > 0 ? driftDetail.join("; ") : "No domain shift detected",
    color: "#f97316",
  });

  // 3. Margin Uncertainty (0-15): low margin in response classification
  let marginRisk = 0;
  const marginVals: number[] = [];
  if (ddcR?.margin != null) marginVals.push(ddcR.margin);
  if (lccR?.margin != null) marginVals.push(lccR.margin);
  if (marginVals.length > 0) {
    const avgMargin = marginVals.reduce((a, b) => a + b, 0) / marginVals.length;
    if (avgMargin < 0.02) marginRisk = 15;
    else if (avgMargin < 0.05) marginRisk = 12;
    else if (avgMargin < 0.10) marginRisk = 8;
    else if (avgMargin < 0.15) marginRisk = 4;
  }
  signals.push({
    key: "margin", label: "Low Classification Margin", value: marginRisk, max: 15,
    score: marginVals.length > 0 ? Math.round(marginVals.reduce((a, b) => a + b, 0) / marginVals.length * 1000) / 10 : 0,
    detail: marginVals.length > 0
      ? `Mean margin ${(marginVals.reduce((a, b) => a + b, 0) / marginVals.length).toFixed(3)}`
      : "No margin data",
    color: "#a78bfa",
  });

  // 4. Linguistic Hedging (0-15)
  const hedgingMatches = (output.match(HEDGING_PAT) || []).length;
  const hedgingDensity = hedgingMatches / wc;
  let hedgingRisk = Math.round(Math.min(hedgingDensity * 100, 15));
  if (isCorrectRefusal && hedgingRisk > 0) {
    hedgingRisk = 0;
  }
  signals.push({
    key: "hedging", label: "Linguistic Hedging", value: hedgingRisk, max: 15,
    score: hedgingMatches,
    detail: hedgingMatches > 0
      ? (isCorrectRefusal ? "Suppressed — hedging is appropriate in a correct refusal" : `${hedgingMatches} hedging phrase${hedgingMatches > 1 ? "s" : ""} (${(hedgingDensity * 100).toFixed(1)}% of words)`)
      : "No hedging detected",
    color: "#fbbf24",
  });

  // 5. Evasiveness (0-15)
  const evasiveMatches = (output.match(EVASIVE_PAT) || []).length;
  const evasiveDensity = evasiveMatches / wc;
  let evasiveRisk = Math.round(Math.min(evasiveDensity * 100, 15));
  if (isCorrectRefusal && evasiveRisk > 0) {
    evasiveRisk = 0;
  }
  signals.push({
    key: "evasive", label: "Evasive Language", value: evasiveRisk, max: 15,
    score: evasiveMatches,
    detail: evasiveMatches > 0
      ? (isCorrectRefusal ? "Suppressed — model correctly declined to fabricate" : `${evasiveMatches} evasive phrase${evasiveMatches > 1 ? "s" : ""} (${(evasiveDensity * 100).toFixed(1)}% of words)`)
      : "No evasive language detected",
    color: "#f87171",
  });

  // 6. Contradiction (0-10)
  const csStep = trace.steps.find((s) => s.label === "Context Assembly");
  const rgStep = trace.steps.find((s) => s.label === "Response Generation");
  const csOut = csStep?.metadata?.output as string | undefined;
  const rgOut = rgStep?.metadata?.output as string | undefined;
  let hasConflict = csOut && rgOut ? detectContradiction(csOut, rgOut) !== null : false;

  // Correct refusal may trigger contradiction between cautious step-5 and step-6 — suppress
  const conflictDetail = hasConflict
    ? (isCorrectRefusal
        ? "Suppressed — context/response disagreement is expected when the model is refusing a fabricated premise"
        : "Context Assembly vs Response Generation conflict detected")
    : "No stage conflict";
  if (isCorrectRefusal) hasConflict = false;

  signals.push({
    key: "contradiction", label: "Stage Contradiction", value: hasConflict ? 10 : 0, max: 10,
    score: hasConflict ? 1 : 0,
    detail: conflictDetail,
    color: "#ec4899",
  });

  // 7. Correct Refusal Bonus (subtracts risk)
  if (isCorrectRefusal) {
    signals.push({
      key: "refusal", label: "Correct Refusal", value: -20, max: 20,
      score: 1,
      detail: "Model recognized hallucination probe and correctly declined to fabricate — −20 risk",
      color: "#34d399",
    });
  }

  const preTotal = signals.reduce((s, sig) => s + sig.value, 0);
  const total = Math.max(preTotal, 0);
  let level = "Low";
  let levelColor = "#34d399";
  if (total >= 25) { level = "Moderate"; levelColor = "#fbbf24"; }
  if (total >= 45) { level = "High"; levelColor = "#f97316"; }
  if (total >= 70) { level = "Very High"; levelColor = "#ef4444"; }

  return { signals, total, level, levelColor, isCorrectRefusal };
}

export default function HallucinationGauge({ trace }: { trace: TraceSession }) {
  const { signals, total, level, levelColor, isCorrectRefusal } = useMemo(() => computeRisk(trace), [trace]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  // Gauge SVG dimensions
  const CX = 140, CY = 125, R = 95;
  const arc = (start: number, end: number, sweep: number, r: number = R) => {
    const s = [CX + r * Math.cos(start), CY + r * Math.sin(start)];
    const e = [CX + r * Math.cos(end), CY + r * Math.sin(end)];
    return `M ${s[0]} ${s[1]} A ${r} ${r} 0 0 ${sweep} ${e[0]} ${e[1]}`;
  };

  const needleAngle = Math.PI * (1 - Math.min(Math.max(total / 100, 0), 1));
  const needleEnd = [CX + R * 0.65 * Math.cos(needleAngle), CY + R * 0.65 * Math.sin(needleAngle)];
  const needleStart = [CX - R * 0.18 * Math.cos(needleAngle), CY - R * 0.18 * Math.sin(needleAngle)];

  const segs: { start: number; end: number; color: string }[] = [
    { start: Math.PI, end: Math.PI * 0.75, color: "#34d399" },
    { start: Math.PI * 0.75, end: Math.PI * 0.55, color: "#fbbf24" },
    { start: Math.PI * 0.55, end: Math.PI * 0.2, color: "#f97316" },
    { start: Math.PI * 0.2, end: 0, color: "#ef4444" },
  ];

  const showTooltip = (e: React.MouseEvent, text: string) => {
    setTooltip({ text, x: e.clientX, y: e.clientY - 10 });
  };

  return (
    <div
      ref={containerRef}
      className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05] space-y-2 cursor-pointer select-none"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2 text-[9px] font-semibold tracking-widest uppercase">
        <span className="text-zinc-400">Hallucination Risk Profile</span>
        {isCorrectRefusal && (
          <span className="text-[8px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded tracking-wider">CORRECT REFUSAL</span>
        )}
        <span className="ml-auto" style={{ color: levelColor }}>{total}/100 · {level}</span>
      </div>

      <svg width="100%" height="150" viewBox="0 0 280 150" className="overflow-visible">
        {/* Background arc track */}
        <path d={arc(Math.PI, 0, 0, R)} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="14" strokeLinecap="round" />

        {/* Colored arc segments */}
        {segs.map((seg, i) => (
          <path
            key={i}
            d={arc(seg.start, seg.end, 0, R)}
            fill="none"
            stroke={seg.color}
            strokeWidth="14"
            strokeLinecap="butt"
            opacity="0.85"
          />
        ))}

        {/* Risk level labels on arc */}
        {[
          { angle: Math.PI * 0.92, label: "LOW", color: "#34d399" },
          { angle: Math.PI * 0.63, label: "MOD", color: "#fbbf24" },
          { angle: Math.PI * 0.35, label: "HIGH", color: "#f97316" },
          { angle: Math.PI * 0.08, label: "V.HIGH", color: "#ef4444" },
        ].map(({ angle, label: lbl, color }, i) => {
          const pt = [CX + (R + 18) * Math.cos(angle), CY + (R + 18) * Math.sin(angle)];
          return (
            <text key={i} x={pt[0]} y={pt[1]} textAnchor="middle" dominantBaseline="middle"
              fill={color} fontSize="7" fontFamily="monospace" fontWeight="bold" opacity="0.6"
            >
              {lbl}
            </text>
          );
        })}

        {/* Needle */}
        <line
          x1={needleStart[0]} y1={needleStart[1]} x2={needleEnd[0]} y2={needleEnd[1]}
          stroke={levelColor} strokeWidth="2.5" strokeLinecap="round"
        />
        <circle cx={CX} cy={CY} r="5" fill={levelColor} stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
        <circle cx={CX} cy={CY} r="2.5" fill="white" />

        {/* Score display */}
        <text x={CX} y={CY + R * 0.4} textAnchor="middle" fill="white" fontSize="16" fontFamily="monospace" fontWeight="bold">
          {total}
        </text>
        <text x={CX} y={CY + R * 0.4 + 13} textAnchor="middle" fill={levelColor} fontSize="8" fontFamily="monospace" fontWeight="bold">
          {level}
        </text>
      </svg>

      {expanded && (
        <>
          {/* Signal breakdown bars */}
          <div className="space-y-1.5 pt-1">
            {signals.map((sig) => {
              const pct = sig.max > 0 ? (sig.value / sig.max) * 100 : 0;
              return (
                <div key={sig.key} className="flex items-center gap-2 text-[10px] font-mono"
                  onMouseEnter={(e) => showTooltip(e, sig.detail)}
                  onMouseMove={(e) => showTooltip(e, sig.detail)}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <span className="text-zinc-500 w-[130px] truncate shrink-0">{sig.label}</span>
                  <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: sig.color, opacity: 0.8 }} />
                  </div>
                  <span className="text-zinc-400 w-6 text-right shrink-0">{sig.value}</span>
                </div>
              );
            })}
          </div>

          {/* Evidence text */}
          {signals.filter(s => s.value > 0).length > 0 && (
            <div className="pt-1 space-y-0.5">
              <div className="text-[8px] font-mono tracking-wider text-zinc-600 uppercase">Evidence</div>
              {signals.filter(s => s.value > 0).map(sig => (
                <div key={sig.key} className="text-[9px] font-mono text-zinc-500 flex items-start gap-1.5">
                  <span style={{ color: sig.color }}>◆</span>
                  {sig.detail}
                </div>
              ))}
            </div>
          )}

          <div className="text-[8px] font-mono text-zinc-700 pt-1 leading-relaxed">
            Aggregates 6 weak signals from embedding classifiers, output text patterns, and stage coherence.
            Higher score = more indicators of possible hallucination or uncertain response.
            {isCorrectRefusal && <span className="text-emerald-600"> Hedging/evasion signals suppressed — model correctly identified a hallucination probe and declined to fabricate.</span>}
          </div>
        </>
      )}

      {!expanded && (
        <div className="text-[8px] font-mono text-zinc-600 text-center">Click to expand signal breakdown</div>
      )}

      {tooltip && createPortal(
        <div className="fixed z-[100] pointer-events-none" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[10px] font-mono text-zinc-200 shadow-xl whitespace-nowrap">
            {tooltip.text}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
