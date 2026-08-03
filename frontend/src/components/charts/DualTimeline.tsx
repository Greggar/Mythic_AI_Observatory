"use client";

import { useMemo, useState } from "react";
import type { TraceSession } from "@/types/trace";

interface IntentProb {
  label: string;
  confidence: number;
  reasoning?: string;
}

interface RetrievedChunk {
  trace_id: string;
  content: string;
  relevance: number;
  used: boolean;
}

interface GhostReference {
  sentence: string;
  ghostGroup: string;
  label: string;
  matchType: "number" | "label" | "overlap";
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokS(evalCount: number | null | undefined, evalDurationNs: number | null | undefined): string {
  if (evalCount == null || evalDurationNs == null || evalDurationNs === 0) return "—";
  return `${(evalCount / (evalDurationNs / 1e9)).toFixed(0)} tok/s`;
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let common = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) common++;
  }
  return common / Math.max(wordsA.size, wordsB.size);
}

function detectGhostReferences(text: string, objectives: ObjectiveCard[]): GhostReference[] {
  if (!text || objectives.length === 0) return [];
  const refs: GhostReference[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const words = sentence.split(/\W+/).filter(Boolean);
    if (words.length < 4) continue;
    for (const obj of objectives) {
      if (!obj.ghostGroup) continue;
      const senNums = [...sentence.matchAll(/\d+(\.\d+)?%?/g)].map((m) => m[0]);
      const valNums = [...obj.value.matchAll(/\d+(\.\d+)?%?/g)].map((m) => m[0]);
      const hasNumMatch = senNums.some((n) => valNums.includes(n));
      if (hasNumMatch) {
        refs.push({ sentence, ghostGroup: obj.ghostGroup, label: obj.label, matchType: "number" });
        break;
      }
      const labelWords = obj.label.toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
      const hasLabel = labelWords.length > 0 && labelWords.some((w) => sentence.toLowerCase().includes(w));
      if (hasLabel) {
        refs.push({ sentence, ghostGroup: obj.ghostGroup, label: obj.label, matchType: "label" });
        break;
      }
      if (wordOverlap(sentence, obj.value) >= 0.15 || wordOverlap(sentence, obj.label) >= 0.15) {
        refs.push({ sentence, ghostGroup: obj.ghostGroup, label: obj.label, matchType: "overlap" });
        break;
      }
    }
  }
  return refs;
}

interface ObjectiveCard {
  label: string;
  value: string;
  unit?: string;
  color?: "teal" | "amber" | "zinc" | "violet";
  ghostGroup?: string;
}

interface RationaleCard {
  label: string;
  text: string;
  detail?: string;
  ghostGroup?: string;
}

interface StagePair {
  stageIndex: number;
  label: string;
  status: string;
  duration: string;
  objective: ObjectiveCard[];
  rationale: RationaleCard[];
}

interface Props {
  trace: TraceSession;
}

function ghostRefKey(sentence: string): string {
  return `ghref-${sentence.slice(0, 40)}`;
}

type GhostKey = string;

function renderGhostText(
  text: string,
  objectives: ObjectiveCard[],
  hoveredRef: GhostKey | null,
  onHoverRef: (k: GhostKey | null) => void,
  onGhost: (g: string | null) => void,
  ghostGroupFromOutside?: string | null,
): React.ReactNode[] {
  const refs = detectGhostReferences(text, objectives);
  if (refs.length === 0) return [<span key="0">{text}</span>];
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.map((sentence, i) => {
    const ref = refs.find((r) => r.sentence === sentence);
    if (!ref) return <span key={i}>{sentence} </span>;
    const k = ghostRefKey(sentence);
    const isHovered = hoveredRef === k || ghostGroupFromOutside === ref.ghostGroup;
    return (
      <span
        key={i}
        className="relative inline cursor-pointer rounded-sm transition-all duration-200"
        style={{
          borderBottom: `1px dotted rgba(167, 139, 250, ${isHovered ? 0.8 : 0.35})`,
          backgroundColor: isHovered ? "rgba(167, 139, 250, 0.08)" : "transparent",
        }}
        onMouseEnter={() => {
          onHoverRef(k);
          onGhost(ref.ghostGroup);
        }}
        onMouseLeave={() => {
          onHoverRef(null);
          onGhost(null);
        }}
        title={`Links to: ${ref.label}`}
      >
        {sentence}{" "}
      </span>
    );
  });
}

export default function DualTimeline({ trace }: Props) {
  const [hoveredGhost, setHoveredGhost] = useState<string | null>(null);
  const [hoveredRef, setHoveredRef] = useState<GhostKey | null>(null);

  const stagePairs = useMemo(() => {
    const pairs: StagePair[] = [];

    for (let i = 0; i < trace.steps.length; i++) {
      const step = trace.steps[i];
      const label = step.label;
      const objective: ObjectiveCard[] = [];
      const rationale: RationaleCard[] = [];

      objective.push({ label: "Duration", value: formatDuration(step.duration_ms), ghostGroup: `${i}-duration` });
      if (step.eval_count != null) {
        objective.push({ label: "Tokens", value: String(step.eval_count), unit: "tok", ghostGroup: `${i}-tokens` });
      }
      if (step.eval_duration_ns != null) {
        objective.push({ label: "Velocity", value: formatTokS(step.eval_count, step.eval_duration_ns), ghostGroup: `${i}-velocity` });
      }

      if (label === "Intent Classification") {
        const probs = step.metadata?.intent_probs as IntentProb[] | undefined;
        if (probs && probs.length > 0) {
          objective.push({
            label: "Top Intent",
            value: probs[0].label,
            color: "teal",
            ghostGroup: `${i}-intent`,
          });
          objective.push({
            label: "Confidence",
            value: `${(probs[0].confidence * 100).toFixed(0)}%`,
            color: probs[0].confidence > 0.5 ? "teal" : "amber",
            ghostGroup: `${i}-intent`,
          });
          for (const intent of probs) {
            if (intent.reasoning) {
              rationale.push({
                label: intent.label,
                text: intent.reasoning,
                detail: `${(intent.confidence * 100).toFixed(0)}% confident`,
                ghostGroup: `${i}-intent`,
              });
            }
          }
        }
      }

      if (label === "Memory Retrieval") {
        const chunks = step.metadata?.retrieved_chunks as RetrievedChunk[] | undefined;
        if (chunks && chunks.length > 0) {
          const used = chunks.filter((c) => c.used).length;
          const discarded = chunks.length - used;
          objective.push({ label: "Chunks found", value: String(chunks.length), unit: "total", ghostGroup: `${i}-chunks` });
          objective.push({ label: "Used", value: String(used), color: "teal", ghostGroup: `${i}-chunks` });
          if (discarded > 0) {
            objective.push({ label: "Discarded", value: String(discarded), color: "amber", ghostGroup: `${i}-chunks` });
          }
          const avgRel = chunks.reduce((s, c) => s + c.relevance, 0) / chunks.length;
          objective.push({
            label: "Avg relevance",
            value: `${(avgRel * 100).toFixed(1)}%`,
            color: avgRel > 0.08 ? "teal" : "amber",
            ghostGroup: `${i}-chunks`,
          });
          for (const chunk of chunks) {
            rationale.push({
              label: chunk.used ? "Used" : "Discarded",
              text: chunk.content.slice(0, 120) + (chunk.content.length > 120 ? "…" : ""),
              detail: `relevance: ${(chunk.relevance * 100).toFixed(0)}%`,
              ghostGroup: chunk.used ? `${i}-chunks` : `${i}-chunks`,
            });
          }
        }
      }

      if (label === "Context Assembly") {
        const output = step.metadata?.output as string | undefined;
        if (output) {
          rationale.push({
            label: "Synthesized intent",
            text: output.replace(/^\[.*?\]:\s*/, "").slice(0, 200),
            ghostGroup: `${i}-context`,
          });
        }
        if (step.context_assembled) {
          objective.push({
            label: "Context length",
            value: `${step.context_assembled.length.toLocaleString()} chars`,
            ghostGroup: `${i}-context`,
          });
        }
      }

      if (label === "Response Generation") {
        const output = step.metadata?.output as string | undefined;
        if (output) {
          objective.push({
            label: "Response length",
            value: `${output.length.toLocaleString()} chars`,
            ghostGroup: `${i}-response`,
          });
        }
        const ent = trace.token_entropy;
        if (ent && ent.mean_entropy != null) {
          const color = ent.mean_entropy > 1.2 ? "amber" : "violet";
          objective.push({
            label: "Token entropy",
            value: ent.mean_entropy.toFixed(2),
            unit: "bits",
            color,
            ghostGroup: `${i}-entropy`,
          });
          objective.push({
            label: "Uncertain tokens",
            value: `${ent.high_entropy_count}/${ent.token_count}`,
            color: ent.high_entropy_count / Math.max(1, ent.token_count) > 0.25 ? "amber" : "violet",
            ghostGroup: `${i}-entropy`,
          });
        }
      }

      pairs.push({
        stageIndex: i,
        label,
        status: step.status,
        duration: formatDuration(step.duration_ms),
        objective,
        rationale,
      });
    }

    const totalDuration = trace.steps.reduce((s, st) => s + (st.duration_ms || 0), 0);
    const overallObjective: ObjectiveCard[] = [
      { label: "Total duration", value: formatDuration(totalDuration), ghostGroup: "overall" },
      { label: "Stages", value: `${trace.steps.filter((s) => s.status === "complete").length}/${trace.steps.length}`, color: "teal", ghostGroup: "overall" },
    ];
    if (trace.confidence != null) {
      overallObjective.push({
        label: "Confidence",
        value: `${(trace.confidence * 100).toFixed(0)}%`,
        color: trace.confidence > 0.5 ? "teal" : "amber",
        ghostGroup: "overall",
      });
    }

    const overallRationale: RationaleCard[] = [];
    if (trace.response_rationale) {
      overallRationale.push({ label: "Response rationale", text: trace.response_rationale, ghostGroup: "overall" });
    }
    if (trace.trace_explanation) {
      overallRationale.push({
        label: "Trace explanation",
        text: trace.trace_explanation.slice(0, 300) + (trace.trace_explanation.length > 300 ? "…" : ""),
        ghostGroup: "overall",
      });
    }

    pairs.push({
      stageIndex: -1,
      label: "Overall",
      status: trace.status,
      duration: formatDuration(totalDuration),
      objective: overallObjective,
      rationale: overallRationale,
    });

    return pairs;
  }, [trace]);

  const isGhosted = (g?: string) => g != null && hoveredGhost != null && hoveredGhost === g;
  const isDimmed = (g?: string) => hoveredGhost != null && (g == null || g !== hoveredGhost);

  return (
    <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-500">
          Dual-Timeline Workspace
        </div>
        <div className="flex items-center gap-2">
          {hoveredGhost && (
            <span className="text-[8px] font-mono text-teal-400/70 animate-pulse">👻 ghost active</span>
          )}
          <span className="text-[8px] font-mono text-zinc-600">
            Objective Trace ↔ LLM Self-Rationale
          </span>
        </div>
      </div>

      <div className="relative">
        <div className="absolute left-[calc(50%-0.5px)] top-0 bottom-0 w-px bg-white/[0.06]" />

        <div className="space-y-2">
          {stagePairs.map((pair) => {
            const isOverall = pair.stageIndex === -1;
            const isActive = !isOverall && trace.steps[pair.stageIndex]?.status === "processing";
            const isError = !isOverall && trace.steps[pair.stageIndex]?.status === "error";

            return (
              <div key={isOverall ? "overall" : pair.label} className="relative">
                <div className="flex justify-center mb-1">
                  <div
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[8px] font-mono font-semibold tracking-wider border ${
                      isOverall
                        ? "bg-white/[0.04] border-white/[0.08] text-zinc-400"
                        : isActive
                          ? "bg-amber-500/20 border-amber-500/30 text-amber-300"
                          : isError
                            ? "bg-red-500/20 border-red-500/30 text-red-300"
                            : "bg-white/[0.03] border-white/[0.06] text-zinc-500"
                    }`}
                  >
                    <span>{pair.label}</span>
                    {isOverall ? null : <span className="text-[7px] opacity-60">{pair.duration}</span>}
                    {pair.status === "complete" && (
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
                  </div>
                </div>

                <div className="flex gap-1.5">
                  {/* Left: Objective Trace */}
                  <div className="flex-1 min-w-0">
                    {pair.objective.length > 0 ? (
                      <div className="rounded-lg border border-teal-500/[0.08] bg-teal-500/[0.02] p-2 space-y-1">
                        <div className="text-[7px] font-semibold tracking-widest uppercase text-teal-600/60 mb-1">
                          System Record
                        </div>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                          {pair.objective.map((card, ci) => {
                            const ghosted = isGhosted(card.ghostGroup);
                            const dimmed = isDimmed(card.ghostGroup);
                            return (
                              <div
                                key={ci}
                                className={`flex items-center justify-between gap-1 min-w-0 rounded px-0.5 -mx-0.5 transition-all duration-200 cursor-default ${
                                  ghosted
                                    ? "bg-teal-500/15 ring-1 ring-teal-400/40 scale-[1.02]"
                                    : dimmed
                                      ? "opacity-30"
                                      : ""
                                }`}
                                onMouseEnter={() => card.ghostGroup && setHoveredGhost(card.ghostGroup)}
                                onMouseLeave={() => setHoveredGhost(null)}
                              >
                                <span className="text-[8px] font-mono text-zinc-500 truncate">{card.label}</span>
                                <span
                                  className={`text-[9px] font-mono font-medium shrink-0 ${
                                    card.color === "teal"
                                      ? "text-teal-400"
                                      : card.color === "amber"
                                        ? "text-amber-400"
                                        : card.color === "violet"
                                          ? "text-violet-400"
                                          : "text-zinc-300"
                                  }`}
                                >
                                  {card.value}
                                  {card.unit ? <span className="text-zinc-600 text-[7px] ml-0.5">{card.unit}</span> : null}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] p-2">
                        <div className="text-[7px] font-semibold tracking-widest uppercase text-zinc-700 mb-1">System Record</div>
                        <span className="text-[8px] font-mono text-zinc-700">No system data</span>
                      </div>
                    )}
                  </div>

                  {/* Right: LLM Self-Rationale */}
                  <div className="flex-1 min-w-0">
                    {pair.rationale.length > 0 ? (
                      <div className="rounded-lg border border-violet-500/[0.08] bg-violet-500/[0.02] p-2 space-y-1">
                        <div className="text-[7px] font-semibold tracking-widest uppercase text-violet-400/60 mb-1">
                          Self-Rationale
                        </div>
                        {(() => {
                          return pair.rationale.slice(0, 3).map((card, ci) => {
                            const ghosted = isGhosted(card.ghostGroup);
                            const dimmed = isDimmed(card.ghostGroup);
                            const cardGhostRefs = detectGhostReferences(card.text, pair.objective);
                            const hasCardRefs = cardGhostRefs.length > 0;
                            return (
                              <div
                                key={ci}
                                className={`border-b border-white/[0.03] pb-0.5 last:border-0 min-w-0 transition-all duration-200 cursor-default rounded px-0.5 -mx-0.5 ${
                                  ghosted
                                    ? "bg-violet-500/15 ring-1 ring-violet-400/40 scale-[1.02]"
                                    : dimmed
                                      ? "opacity-30"
                                      : ""
                                }`}
                                onMouseEnter={() => card.ghostGroup && setHoveredGhost(card.ghostGroup)}
                                onMouseLeave={() => setHoveredGhost(null)}
                              >
                                <div className="flex items-center gap-1">
                                  <span className="text-[7px] font-mono font-medium text-violet-400/70 uppercase tracking-wider truncate">
                                    {card.label}
                                  </span>
                                  {card.detail && (
                                    <span className="text-[7px] font-mono text-zinc-600 ml-auto">{card.detail}</span>
                                  )}
                                </div>
                                <div
                                  className={`text-[8px] font-mono text-zinc-400 leading-relaxed mt-0.5 break-words ${
                                    hasCardRefs || !card.text || card.text.length < 80 ? "" : "line-clamp-2"
                                  }`}
                                >
                                  {renderGhostText(
                                    card.text,
                                    pair.objective,
                                    hoveredRef,
                                    setHoveredRef,
                                    setHoveredGhost,
                                    hoveredGhost,
                                  )}
                                </div>
                              </div>
                            );
                          });
                        })()}
                        {pair.rationale.length > 3 && (
                          <div className={`text-[7px] font-mono ${hoveredGhost ? "text-zinc-600" : "text-zinc-600"}`}>
                            +{pair.rationale.length - 3} more
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] p-2">
                        <div className="text-[7px] font-semibold tracking-widest uppercase text-zinc-700 mb-1">Self-Rationale</div>
                        <span className="text-[8px] font-mono text-zinc-700">No self-rationale data</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Key at bottom */}
      <div className="flex items-center gap-4 mt-3 pt-2 border-t border-white/[0.04]">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded" style={{ background: "rgba(45,212,191,0.4)" }} />
          <span className="text-[7px] font-mono text-zinc-600">System measurements</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded" style={{ background: "rgba(139,92,246,0.4)" }} />
          <span className="text-[7px] font-mono text-zinc-600">Model reasoning</span>
        </div>
        {hoveredGhost ? (
          <span className="text-[7px] font-mono text-teal-400/70">
            Hover to reveal the ghost — matched data highlights on both sides
          </span>
        ) : (
          <span className="text-[7px] font-mono text-zinc-700">
            Hover any card to reveal its ghost counterpart
          </span>
        )}
      </div>
    </div>
  );
}
