"use client";

import { useMemo } from "react";

const DDC_SHORT = ["Gen", "Phil", "Rel", "Soc", "Lang", "Sci", "Tech", "Art", "Lit", "Hist"];
const DDC_COLORS = ["#6b7280", "#a78bfa", "#f87171", "#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#fb923c", "#818cf8", "#2dd4bf"];

const CELL = 28;
const LABEL_W = 90;
const PANEL_W = LABEL_W + 10 * CELL + 20;

interface Props {
  traces: {
    ddc?: {
      prompt?: { code?: string; action?: string; label?: string; score?: number; margin?: number; top_scores?: { code: string; label: string; score: number }[] } | null;
    } | null;
  }[];
}

function mainClassDigit(code: string): number | null {
  const d = parseInt(code[0]);
  return isNaN(d) ? null : d;
}

export default function EmbeddingConfusionProfile({ traces }: Props) {
  const {
    confusionCounts,
    totalConflicts,
    mainClassCounts,
    highestPairs,
  } = useMemo(() => {
    const confusion = Array.from({ length: 10 }, () => Array(10).fill(0));
    const counts = Array(10).fill(0);
    let conflicts = 0;

    for (const t of traces) {
      const ts = t.ddc?.prompt?.top_scores;
      if (!ts || ts.length < 2) continue;
      const d0 = mainClassDigit(ts[0].code);
      const d1 = mainClassDigit(ts[1].code);
      if (d0 === null || d1 === null) continue;
      counts[d0]++;
      const margin = ts[0].score - ts[1].score;
      if (margin < 0.05 && margin >= 0) {
        confusion[d0][d1]++;
        conflicts++;
      }
    }

    const pairs: { a: number; b: number; count: number }[] = [];
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        if (i !== j && confusion[i][j] > 0) {
          pairs.push({ a: i, b: j, count: confusion[i][j] });
        }
      }
    }
    pairs.sort((x, y) => y.count - x.count);

    return {
      confusionCounts: confusion,
      totalConflicts: conflicts,
      mainClassCounts: counts,
      highestPairs: pairs.slice(0, 5),
    };
  }, [traces]);

  const maxVal = Math.max(1, ...confusionCounts.flat());

  return (
    <div className="p-4">
      {/* Narrative */}
      <div className="mb-4 text-[10px] font-mono text-zinc-400 leading-relaxed max-w-[640px]">
        <p className="mb-2">
          The DDC classifier uses an all-minilm embedding model to map your prompt into a 384-dimensional
          vector, then finds the closest DDC category by cosine similarity. <em>This embedding space has its own
          implicit ontology</em> — two DDC categories might be close neighbours in embedding space even when they
          feel unrelated to a human reader, because the texts used to describe them share vocabulary.
        </p>
        <p className="mb-2">
          The heatmap below shows which DDC main classes the model most often <em>hesitates between</em> — cases
          where the top-2 scores are within 0.05 of each other (i.e., the model is guessing). Each off-diagonal
          cell (i,j) is a trace where main class <em>i</em> won but <em>j</em>
          was a near-tie runner-up.
        </p>
        <p className="text-zinc-500">
          When you disagree with a classification, check the <em>margin</em>. A low margin (
          <span style={{ color: "#f87171" }}>red dot</span>) means the embedding model could not confidently
          distinguish between alternatives — its choice is essentially arbitrary. A high margin (
          <span style={{ color: "#34d399" }}>green dot</span>) means the signal was unambiguous.
          The classification is not wrong or right — it is a <em>measurement through a specific lens</em>,
          and the confidence tells you how reliable that measurement is.
        </p>
      </div>

      {/* Confusion heatmap */}
      <svg viewBox={`0 0 ${PANEL_W} ${LABEL_W + 10 * CELL + 20}`} className="w-full h-auto max-w-[420px]" preserveAspectRatio="xMidYMid meet">
        <text x={LABEL_W + 5 * CELL} y={10} textAnchor="middle" fill="rgba(161,161,170,0.5)" fontSize={8} fontFamily="monospace">
          RUNNER-UP MAIN CLASS
        </text>
        {Array.from({ length: 10 }, (_, row) => (
          <g key={`row-${row}`}>
            <text x={LABEL_W - 4} y={22 + row * CELL + CELL / 2 + 1} textAnchor="end" fill={DDC_COLORS[row]} fontSize={8} fontFamily="monospace">
              {row} {DDC_SHORT[row]}
            </text>
            {Array.from({ length: 10 }, (_, col) => {
              const val = confusionCounts[row][col];
              const pct = maxVal > 0 ? val / maxVal : 0;
              const t = Math.pow(pct, 0.5);
              const isDiag = row === col;
              const r = isDiag ? 20 : Math.round(40 + t * 215);
              const g = isDiag ? 30 : Math.round(140 + t * 115);
              const b = isDiag ? 25 : Math.round(170 + t * 85);
              return (
                <rect
                  key={`c-${row}-${col}`}
                  x={LABEL_W + col * CELL}
                  y={20 + row * CELL}
                  width={CELL - 2}
                  height={CELL - 2}
                  rx={2}
                  fill={isDiag ? "rgba(255,255,255,0.04)" : `rgb(${Math.min(r, 255)},${Math.min(g, 255)},${Math.min(b, 255)})`}
                >
                  <title>
                    {row === col
                      ? `${DDC_SHORT[row]} (diagonal — ignored)`
                      : `${DDC_SHORT[row]} → ${DDC_SHORT[col]}: ${val} conflict${val !== 1 ? "s" : ""} (${traces.length > 0 ? ((val / traces.length) * 100).toFixed(1) : "0"}% of traces)`
                    }
                  </title>
                </rect>
              );
            })}
          </g>
        ))}
        {Array.from({ length: 10 }, (_, col) => (
          <text key={`col-label-${col}`}
            x={LABEL_W + col * CELL + CELL / 2}
            y={20 + 10 * CELL + 12}
            textAnchor="end"
            fill={DDC_COLORS[col]} fontSize={7} fontFamily="monospace"
            transform={`rotate(-45, ${LABEL_W + col * CELL + CELL / 2}, ${20 + 10 * CELL + 12})`}
          >
            {col} {DDC_SHORT[col]}
          </text>
        ))}
      </svg>

      {/* Top confused pairs */}
      {highestPairs.length > 0 && (
        <div className="mt-4 max-w-[420px]">
          <div className="text-[10px] font-mono text-zinc-500 mb-1.5">Most confused pairs (margin &lt; 0.05):</div>
          {highestPairs.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px] font-mono mb-1">
              <span style={{ color: DDC_COLORS[p.a], fontWeight: 600 }}>{DDC_SHORT[p.a]}</span>
              <span className="text-zinc-600">↔</span>
              <span style={{ color: DDC_COLORS[p.b], fontWeight: 600 }}>{DDC_SHORT[p.b]}</span>
              <span className="text-zinc-500">×{p.count}</span>
              <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                <div className="h-full rounded-full bg-teal-mystic/40" style={{ width: `${(p.count / Math.max(1, highestPairs[0].count)) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {totalConflicts === 0 && traces.length >= 3 && (
        <div className="mt-3 text-[10px] font-mono text-zinc-600">
          No close conflicts found — the model is decisive on this dataset (margin &ge; 0.05 on all traces).
        </div>
      )}
    </div>
  );
}
