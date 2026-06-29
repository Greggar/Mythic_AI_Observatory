"use client";

import { useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";

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

const RING_HEADERS = ["DEPTH", "MOOD", "SYNTAX", "ACTION", "TONE", "FORM"];
const RING_HEADER_COLORS = ["#f472b6", "#ef4444", "#34d399", "#06b6d4", "#6366f1", "#a855f7"];

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "Interjection": "Single-word exclamation that begins the prompt (Oh, Wow, Please)",
  "Minor Sentence": "Short fixed-phrase greeting, acknowledgment, or one-word reply (Hello, Yes, Thanks)",
  "Full Verb Phrase": "Complete sentence with a verb — standard declarative or imperative construction",
  "Imperative": "Direct command or instruction — tells the model what to do",
  "Indicative": "Statement of fact, observation, or declarative assertion",
  "Interrogative": "Question ending with ? seeking information or clarification",
  "Conditional": "If/then or hypothetical construction (if, when, unless, assuming)",
  "Subjunctive": "Roleplay, imaginative, or hypothetical framing (act as, imagine, pretend)",
  "Simple": "Single independent clause — one idea, one sentence",
  "Compound": "Multiple independent clauses joined by coordinating conjunctions (and, but, or)",
  "Complex": "Multiple clauses with subordinating conjunctions (because, although, while, since)",
  "Direct Execution": "Fulfilled request — the model produces the requested output without hedging",
  "Conversational Phatic": "Polite conversational filler or acknowledgment (Sure!, Of course)",
  "Refusal/Guardrail": "Refusal, apology, or safety guardrail triggered (I'm sorry, I cannot)",
  "Informative": "Neutral, factual presentation of information without strong stylistic color",
  "Instructional": "Step-by-step guidance, tutorial, or how-to instructions",
  "Entertainment": "Humor, playfulness, or lighthearted tone (jokes, witty banter)",
  "Creative": "Evocative, artistic, or poetic language — metaphor, imagery, aesthetic framing",
  "Analytical": "Critical examination with reasoning structure (however, therefore, thus)",
  "Corrective": "Warning, correction, or cautionary note (be careful, important, never)",
  "Structured (Code/Tables)": "Code blocks, markdown tables, or structured headers with formatting",
  "Bulleted/Fragmented": "Itemized list using bullet points, dashes, or numbered items",
  "Continuous Prose": "Paragraph-style narrative or explanation without list formatting",
  "Verse": "Poetic structure — short lines, stanzas, rhythmic or literary patterning",
};

const N = RING_SPEC.reduce((s, r) => s + r.size, 0); // 24

// Build ring offsets: [0, 3, 8, 11, 14, 20, 24]
function buildRingOffsets(): number[] {
  const offsets = [0];
  for (const r of RING_SPEC) offsets.push(offsets[offsets.length - 1] + r.size);
  return offsets;
}
const RING_OFFSETS = buildRingOffsets();

const CELL_SIZE = 22;
const RING_GAP = 3;
const LABEL_W = 130;
const HEADER_H = 14;

interface TooltipState {
  x: number;
  y: number;
  rowLabel: string;
  colLabel: string;
  value: number;
  rowCat: string;
  colCat: string;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  const sumY2 = y.reduce((a, b) => a + b * b, 0);
  const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return den === 0 ? 0 : num / den;
}

function correlationBg(r: number): string {
  if (Math.abs(r) < 1e-10) return "rgba(255,255,255,0.03)";
  const absR = Math.abs(r);
  const intensity = Math.pow(absR, 0.5);
  if (r > 0) {
    const g = Math.round(140 + intensity * 115);
    return `rgb(${Math.round(20 + intensity * 40)},${Math.min(g, 255)},${Math.round(160 + intensity * 95)})`;
  }
  const rVal = Math.round(160 + intensity * 95);
  return `rgb(${Math.min(rVal, 255)},${Math.round(30 + intensity * 40)},${Math.round(40 + intensity * 60)})`;
}

interface Props {
  traces: { id: string; prompt: string; output: string | null }[];
}

export default function SynesthCorrelationHeatmap({ traces }: Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [minCorr, setMinCorr] = useState(0);

  // Flatten all labels in order
  const allLabels = useMemo(() => RING_LABELS.flat(), []);

  // Classify each trace into 6 ring categories (prompt-side: 0-2, response-side: 3-5)
  const traceCategories = useMemo(() => {
    return traces.map((t) => {
      const prompt = t.prompt.trim();
      const text = t.output || "";

      // Depth (same as RelationshipsPanel classifyDepth)
      const hasInterj = /^(Oh|Wow|Please|Ah|Hey|Alas|Ooh|Aha|Oops|Ugh|Yay|Hmm|Well)\b/i.test(prompt);
      const isMinor = /^(Hello|Hi|Hey|Yes|No|Thanks|Thank you|Goodbye|Bye|Sure|Okay|OK|Fine|Great|Awesome|Perfect|Help|Why not|Of course|Never mind|Got it|Right|Absolutely|Exactly|Agreed|Good|Alright|Bye)\s*[.!?]?\s*$/i.test(prompt) || prompt.split(/\s+/).length <= 3;
      const depth = hasInterj ? 0 : isMinor ? 1 : 2;

      // Mood5 (same as RelationshipsPanel classifyMood5)
      let mood = 0;
      if (/^(if|when|whenever|should|unless|provided that|assuming|given that)\b/i.test(prompt) || /\b(if .+ then|if you|when you|unless you)\b/i.test(prompt)) mood = 3;
      else if (/^(act as|imagine|pretend|suppose|picture|consider what if|what would|what if)\b/i.test(prompt) || /\b(as if|as though|act like|speak as|role.?play)\b/i.test(prompt)) mood = 4;
      else if (prompt.endsWith("?") || /^(what|how|why|where|when|which|could|would|should|can|do|does|is|are|will)\b/i.test(prompt)) mood = 2;
      else if (/^(the|this|that|there|it|we|they|he|she|i)\b/i.test(prompt) || /^[A-Z]/.test(prompt)) mood = 1;

      // Syntax
      const coordConj = /\b(and|but|or|yet|so|for|nor)\b/i;
      const subordConj = /\b(because|although|while|since|unless|if|when|whereas|though|as|until|after|before|once|that|which|who|whom|whose|where|when|why|how)\b/i;
      const clauses = prompt.split(/[.!?]+/).filter(Boolean);
      const hasCoord = coordConj.test(prompt);
      const hasSubord = subordConj.test(prompt);
      const syntax = hasSubord || (clauses.length > 1 && hasCoord) ? 2 : hasCoord || clauses.length > 1 ? 1 : 0;

      // Action Type
      let action = 1;
      if (text) {
        if (/^(i'?m (sorry|unable|cannot|can'?t|not able|not designed)|i cannot|i can'?t|as an ai|i don'?t have|i do not have|i apologize|unable to|cannot fulfill|cannot provide|i must|i should not|that'?s beyond|that is beyond)/i.test(text)) action = 2;
        else if (/^(sure|okay|ok|of course|happy to|gladly|certainly|absolutely|yes|here'?s|here is|here are|i'?ll|let me|i can|i will)\b/i.test(text) || /```/.test(text) || text.length < 30) action = 0;
      }

      // Pragmatic Tone
      let tone = 0;
      if (text) {
        if (/\b(joke|humor|funny|silly|amusing|hilarious|playful|limerick|light.?hearted|haiku|sonnet|limerick)\b/i.test(text)) tone = 2;
        else if (/\b(metaphor|imagine|picture|evocative|vivid|story|poem|poetic|beautiful|art|artistic|aesthetic|mood|atmosphere|shadow|light|breathtaking|sublime|dream|dreamlike|surreal)\b/i.test(text)) tone = 3;
        else if (/\b(however|therefore|thus|consequently|furthermore|analysis|analyze|examine|compare|contrast|perspective|lens|dimension|factor|parameter|framework|paradigm)\b/i.test(text)) tone = 4;
        else if (/\b(warning|caution|careful|be careful|note that|important|critical|you should|you need to|make sure|ensure|remember to|don'?t forget|must|should not|incorrect|wrong|mistake|error|flaw|issue|problem|never)\b/i.test(text)) tone = 5;
        else if (/\b(step|follow|instructions|how to|guide|tutorial|walkthrough|do this|you can|you will|start by|begin by|first|next|then|finally|procedure|process)\b/i.test(text)) tone = 1;
      }

      // Output Form
      let form = 2;
      if (text) {
        if (/```/.test(text) || /\|.*\|.*\|/.test(text) || /^#{1,6}\s/m.test(text)) form = 0;
        else if (/^[-*]\s/m.test(text) || /^\d+\.\s/m.test(text)) form = 1;
        else {
          const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
          if (lines.length >= 3) {
            const avgLen = lines.reduce((s, l) => s + l.length, 0) / lines.length;
            const maxLen = Math.max(...lines.map(l => l.length));
            if (avgLen < 55 && maxLen < 80) form = 3;
          }
        }
      }

      return [depth, mood, syntax, action, tone, form];
    });
  }, [traces]);

  // Correlation matrix: 24 x 24
  const corrMatrix = useMemo(() => {
    const n = N;
    const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    const nTraces = traceCategories.length;
    if (nTraces < 3) return matrix;

    // Build one-hot vectors for each category
    const vectors: number[][] = Array.from({ length: n }, () => []);
    for (const cats of traceCategories) {
      for (let ring = 0; ring < 6; ring++) {
        const offset = RING_OFFSETS[ring];
        for (let cat = 0; cat < RING_SPEC[ring].size; cat++) {
          vectors[offset + cat].push(cat === cats[ring] ? 1 : 0);
        }
      }
    }

    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1;
      for (let j = i + 1; j < n; j++) {
        // Only compute cross-ring correlations (different rings)
        const ri = RING_OFFSETS.findIndex((o, idx) => o <= i && i < RING_OFFSETS[idx + 1]);
        const rj = RING_OFFSETS.findIndex((o, idx) => o <= j && j < RING_OFFSETS[idx + 1]);
        if (ri === rj) {
          matrix[i][j] = 0;
          matrix[j][i] = 0;
          continue;
        }
        const r = pearsonCorrelation(vectors[i], vectors[j]);
        matrix[i][j] = r;
        matrix[j][i] = r;
      }
    }
    return matrix;
  }, [traceCategories]);

  const visibleCorrMatrix = useMemo(() => {
    return corrMatrix.map(row =>
      row.map(v => (Math.abs(v) >= minCorr ? v : 0))
    );
  }, [corrMatrix, minCorr]);

  // Compute total dimensions
  const ringWidths = RING_SPEC.map(r => r.size * CELL_SIZE + RING_GAP);
  const totalW = LABEL_W + ringWidths.reduce((a, b) => a + b, 0) + 10;
  const totalH = HEADER_H + N * CELL_SIZE + 16;

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, row: number, col: number) => {
      if (row === col) return;
      const v = corrMatrix[row][col];
      if (Math.abs(v) < 1e-10) return;
      setTooltip({
        x: e.clientX,
        y: e.clientY,
        rowLabel: RING_HEADERS[RING_OFFSETS.findIndex((o, idx) => o <= row && row < RING_OFFSETS[idx + 1])],
        colLabel: RING_HEADERS[RING_OFFSETS.findIndex((o, idx) => o <= col && col < RING_OFFSETS[idx + 1])],
        value: v,
        rowCat: allLabels[row],
        colCat: allLabels[col],
      });
    },
    [corrMatrix, allLabels]
  );

  const colX = useMemo(() => {
    const xs: number[] = [];
    let x = LABEL_W;
    for (let ring = 0; ring < 6; ring++) {
      for (let cat = 0; cat < RING_SPEC[ring].size; cat++) {
        xs.push(x + cat * CELL_SIZE);
      }
      x += RING_SPEC[ring].size * CELL_SIZE + RING_GAP;
    }
    return xs;
  }, []);

  return (
    <div className="p-4">
      {traces.length < 3 ? (
        <div className="flex items-center justify-center" style={{ minHeight: "140px" }}>
          <span className="text-[10px] font-mono text-zinc-600">Need at least 3 traces</span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-3">
            {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((t) => (
              <button
                key={t}
                onClick={() => setMinCorr(t)}
                className={`text-[9px] font-mono px-2 py-0.5 rounded transition-colors ${
                  minCorr === t
                    ? "bg-teal-700/50 text-teal-200 border border-teal-500/30"
                    : "bg-white/[0.03] text-zinc-500 border border-white/[0.06] hover:text-zinc-300 hover:bg-white/[0.06]"
                }`}
              >
                |r| &ge; {t.toFixed(1)}
              </button>
            ))}
          </div>
          <svg
            viewBox={`0 0 ${totalW} ${totalH}`}
            className="w-full h-auto"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Column header: ring labels */}
            {RING_OFFSETS.slice(0, 6).map((offset, ring) => {
              const x = colX[offset] || LABEL_W;
              const w = RING_SPEC[ring].size * CELL_SIZE;
              const desc = ring === 0 ? "Depth of prompt — interjection, minor sentence, or full verb phrase"
                : ring === 1 ? "Grammatical mood of the prompt"
                : ring === 2 ? "Syntactic complexity (clause structure)"
                : ring === 3 ? "How the model executes the response — direct, phatic, or refusal"
                : ring === 4 ? "Pragmatic tone and stylistic register of the response"
                : "Structural format of the response text";
              return (
                <text
                  key={`colh-${ring}`}
                  x={x + w / 2}
                  y={HEADER_H - 3}
                  textAnchor="middle"
                  fill={RING_HEADER_COLORS[ring]}
                  fontSize={8}
                  fontFamily="monospace"
                  fontWeight={600}
                >
                  <title>{desc}</title>
                  {RING_HEADERS[ring]}
                </text>
              );
            })}

            {/* Row labels */}
            {allLabels.map((label, row) => {
              const ring = RING_OFFSETS.findIndex((o, idx) => o <= row && row < RING_OFFSETS[idx + 1]);
              const y = HEADER_H + row * CELL_SIZE + CELL_SIZE / 2 + 1;
              return (
                <text
                  key={`rl-${row}`}
                  x={LABEL_W - 6}
                  y={y}
                  textAnchor="end"
                  fill={RING_COLORS[ring]?.[row - RING_OFFSETS[ring]]?.replace(")", ",0.6)") || "rgba(161,161,170,0.6)"}
                  fontSize={8}
                  fontFamily="monospace"
                >
                  <title>{CATEGORY_DESCRIPTIONS[label] || label}</title>
                  {label}
                </text>
              );
            })}

            {/* Mini ring-group labels on row side */}
            {RING_OFFSETS.slice(0, 6).map((offset, ring) => {
              const y = HEADER_H + offset * CELL_SIZE + (RING_SPEC[ring].size * CELL_SIZE) / 2;
              return (
                <text
                  key={`rlh-${ring}`}
                  x={8}
                  y={y + 3}
                  textAnchor="start"
                  fill={RING_HEADER_COLORS[ring]}
                  fontSize={8}
                  fontFamily="monospace"
                  fontWeight={600}
                  opacity={0.5}
                >
                  {RING_HEADERS[ring]}
                </text>
              );
            })}

            {/* Cells */}
            {allLabels.map((_, row) =>
              allLabels.map((_, col) => {
                const v = visibleCorrMatrix[row][col];
                const ri = RING_OFFSETS.findIndex((o, idx) => o <= row && row < RING_OFFSETS[idx + 1]);
                const ci = RING_OFFSETS.findIndex((o, idx) => o <= col && col < RING_OFFSETS[idx + 1]);
                if (ri === -1 || ci === -1) return null;
                const x = colX[col];
                const y = HEADER_H + row * CELL_SIZE;
                return (
                  <rect
                    key={`c-${row}-${col}`}
                    x={x}
                    y={y}
                    width={CELL_SIZE - 1}
                    height={CELL_SIZE - 1}
                    rx={1.5}
                    fill={correlationBg(v)}
                    stroke={ri === ci ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)"}
                    strokeWidth={0.5}
                    className="cursor-pointer transition-opacity hover:opacity-80"
                    onMouseEnter={(e) => handleMouseEnter(e, row, col)}
                    onMouseMove={(e) => setTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                    onMouseLeave={() => setTooltip(null)}
                  />
                );
              })
            )}

            {/* Ring divider lines (column side) */}
            {RING_OFFSETS.slice(1, 6).map((offset) => {
              const x = colX[offset] - RING_GAP / 2;
              return (
                <line
                  key={`coldiv-${offset}`}
                  x1={x}
                  y1={HEADER_H}
                  x2={x}
                  y2={HEADER_H + N * CELL_SIZE}
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth={1}
                />
              );
            })}

            {/* Ring divider lines (row side) */}
            {RING_OFFSETS.slice(1, 6).map((offset) => {
              const y = HEADER_H + offset * CELL_SIZE;
              return (
                <line
                  key={`rowdiv-${offset}`}
                  x1={LABEL_W}
                  y1={y}
                  x2={totalW - 10}
                  y2={y}
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth={1}
                />
              );
            })}
          </svg>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded" style={{ background: "rgb(20,140,160)" }} />
              <span className="text-[8px] font-mono text-zinc-500">Positive</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded" style={{ background: "rgb(160,30,40)" }} />
              <span className="text-[8px] font-mono text-zinc-500">Negative</span>
            </div>
            <span className="text-[8px] font-mono text-zinc-600">darker = stronger | diagonal (same-ring) masked</span>
          </div>
        </>
      )}

      {tooltip && createPortal(
        <div
          className="fixed z-[100] pointer-events-none bg-black/85 border border-white/[0.08] rounded-lg px-3 py-2 shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <div className="text-[10px] font-mono text-zinc-400">
            <span className="text-[9px] tracking-wider text-zinc-600">{tooltip.rowLabel}</span>
            {" "}{tooltip.rowCat}
          </div>
          <div className="text-[10px] font-mono text-zinc-400">
            <span className="text-[9px] tracking-wider text-zinc-600">{tooltip.colLabel}</span>
            {" "}{tooltip.colCat}
          </div>
          <div className="text-[11px] font-mono mt-1" style={{ color: tooltip.value >= 0 ? "#5eead4" : "#fca5a5" }}>
            r = {tooltip.value.toFixed(3)}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
