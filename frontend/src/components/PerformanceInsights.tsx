"use client";

import { useMemo, useRef } from "react";
import { Lightbulb } from "lucide-react";
import type { TraceSession, LlmInsight } from "@/types/trace";

interface Insight {
  level: "critical" | "warning" | "info" | "optimal";
  title: string;
  body: string;
}

const BADGE: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  warning: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  info: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  optimal: "bg-green-500/20 text-green-400 border-green-500/30",
};

const LLM_BADGE: Record<string, string> = {
  info: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  recommendation: "bg-violet-500/20 text-violet-400 border-violet-500/30",
};

const LABEL: Record<string, string> = {
  critical: "CRITICAL",
  warning: "WARNING",
  info: "INFO",
  optimal: "OPTIMAL",
};

interface StageRange {
  good: [number, number];
  ok: [number, number];
  bad: number;
}

interface ModelProfile {
  label: string;
  stages: Record<string, StageRange>;
}

function buildProfile(modelKey: string, modelLabel: string): ModelProfile {
  const isLocal = modelKey === "local" || modelKey.includes("qwen");
  const scale = isLocal ? 1 : 0.35;
  return {
    label: `${modelLabel}${isLocal ? " on CPU" : " on GPU"}`,
    stages: {
      "Intent Classification": {
        good: [12000 * scale, 20000 * scale],
        ok: [20000 * scale, 30000 * scale],
        bad: 30000 * scale,
      },
      "Context Synthesis": {
        good: [4000 * scale, 8000 * scale],
        ok: [8000 * scale, 12000 * scale],
        bad: 12000 * scale,
      },
      "Response Generation": {
        good: [20000 * scale, 35000 * scale],
        ok: [35000 * scale, 50000 * scale],
        bad: 50000 * scale,
      },
    },
  };
}

function fmt(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function assess(
  ms: number,
  range: StageRange,
): { verdict: "good" | "ok" | "bad"; label: string } {
  if (ms < range.good[1]) return { verdict: "good", label: "within normal range" };
  if (ms < range.ok[1]) return { verdict: "ok", label: "slightly elevated" };
  return { verdict: "bad", label: "unusually slow" };
}

function generate(
  trace: TraceSession,
  sessionSeen: Map<string, { min: number; max: number }>,
): Insight[] {
  const insights: Insight[] = [];
  const steps = trace.steps || [];
  const stepMap = new Map<string, number>();
  for (const s of steps) {
    if (s.label && s.duration_ms != null) {
      stepMap.set(s.label, s.duration_ms);
    }
  }

  const totalMs = [...stepMap.values()].reduce((a, b) => a + b, 0);
  const totalSec = totalMs / 1000;
  const modelLabel = trace.model_used || "local";
  const modelKey = modelLabel.toLowerCase();
  const profile = buildProfile(modelKey, modelLabel);
  const promptLen = (trace.prompt || "").length;

  const isFirstTrace = sessionSeen.size === 0;

  for (const [label, ms] of stepMap) {
    const range = profile.stages[label];
    if (!range) continue;

    const { verdict, label: assessmentLabel } = assess(ms, range);

    const seen = sessionSeen.get(label);
    const prevMin = seen?.min;
    const prevMax = seen?.max;
    const isColdStart = isFirstTrace || (prevMin === undefined);

    if (verdict === "bad") {
      const pct = totalMs > 0 ? ((ms / totalMs) * 100).toFixed(0) : "?";
      const reasons: string[] = [];
      if (isColdStart) {
        reasons.push("This is the first trace this session — the model was paged out of RAM (cold start).");
      }
      if (promptLen > 200) {
        reasons.push(`The prompt is ${promptLen} characters — longer inputs increase classification time.`);
      }
      if (prevMin !== undefined && ms > prevMax! * 1.5) {
        reasons.push(`This is ${fmt(ms)} — ${fmt(prevMin!)} was the fastest this session, suggesting variable load.`);
      }
      reasons.push(
        `Expected range for ${profile.label}: ${fmt(range.good[0])}–${fmt(range.good[1])}.`,
      );

      insights.push({
        level: "critical",
        title: `${label} slow`,
        body: `${fmt(ms)} (${pct}% of run). ${reasons.join(" ")}`,
      });
    } else if (verdict === "ok") {
      insights.push({
        level: "warning",
        title: `${label} elevated`,
        body:
          `${fmt(ms)} — slightly above the normal range (${fmt(range.good[0])}–${fmt(range.good[1])}) ` +
          `for ${profile.label}.${isColdStart ? " Likely a cold start." : ""}`,
      });
    }

    if (verdict === "good" && !isColdStart) {
      const prevRange = prevMin !== undefined ? `${fmt(prevMin)}–${fmt(prevMax!)}` : null;
      insights.push({
        level: "info",
        title: `${label} OK`,
        body:
          `${fmt(ms)} — within normal range for ${profile.label}.` +
          (prevRange ? ` Session range: ${prevRange}.` : ""),
      });
    }
  }

  if (totalSec < 5 && insights.length === 0) {
    insights.push({
      level: "optimal",
      title: "Fast pipeline",
      body: "Completed in under 5s. Likely due to prompt caching, warm model, or minimal retrieval.",
    });
  }

  const nonModelStages = ["Request Received", "Agent Selection", "Memory Retrieval", "Final Response"];
  for (const label of nonModelStages) {
    const ms = stepMap.get(label) || 0;
    if (ms > 500) {
      insights.push({
        level: "warning",
        title: `${label} delay`,
        body: `${fmt(ms)} — expected ~50ms for this non-model stage. Possible I/O contention.`,
      });
    }
  }

  if (profile) {
    const coldNotice = isFirstTrace
      ? " This is the first trace — cold start expected."
      : "";
    const gpuNotice = profile.label.includes("on CPU")
      ? " BackOffice with RTX 5070 Ti would cut these times by ~5x."
      : "";
    insights.push({
      level: "info",
      title: profile.label,
      body:
        `Prompt: ${promptLen} chars.${coldNotice}${gpuNotice}`,
    });
  }

  return insights;
}

export default function PerformanceInsights({ trace }: { trace: TraceSession | null }) {
  const sessionSeen = useRef(new Map<string, { min: number; max: number }>());

  const insights = useMemo(() => {
    if (!trace) return [];
    const result = generate(trace, sessionSeen.current);
    for (const step of trace.steps || []) {
      if (step.label && step.duration_ms != null) {
        const seen = sessionSeen.current.get(step.label);
        if (seen) {
          seen.min = Math.min(seen.min, step.duration_ms);
          seen.max = Math.max(seen.max, step.duration_ms);
        } else {
          sessionSeen.current.set(step.label, {
            min: step.duration_ms,
            max: step.duration_ms,
          });
        }
      }
    }
    return result;
  }, [trace]);

  const llmInsights: LlmInsight[] = (trace?.llm_insights) || [];

  return (
    <div className="glass-panel p-4 space-y-3">
      <div className="flex flex-col items-center gap-1.5 text-teal-mystic">
        <Lightbulb size={16} />
        <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-[oklch(72%_0.11_75)] font-[system-ui]">
          Insights
        </span>
      </div>

      {!trace ? (
        <div className="text-[10px] text-zinc-600 text-center py-4 font-mono">
          No trace to analyze
        </div>
      ) : (
        <div className="space-y-2">
          {insights.map((ins, i) => (
            <div
              key={i}
              className={`rounded-lg border px-3 py-2 space-y-1 ${BADGE[ins.level]}`}
            >
              <div className="text-[9px] font-mono font-semibold tracking-wider uppercase opacity-80">
                {LABEL[ins.level]}
              </div>
              <div className="text-[10px] leading-relaxed opacity-90">
                <span className="font-semibold">{ins.title}</span>
                <br />
                {ins.body}
              </div>
            </div>
          ))}

          {llmInsights.length > 0 && (
            <>
              <div className="pt-1 border-t border-white/[0.04]" />
              {llmInsights.map((ins, i) => (
                <div
                  key={i}
                  className={`rounded-lg border px-3 py-2 space-y-1 ${LLM_BADGE[ins.type] || LLM_BADGE.info}`}
                >
                  <div className="text-[9px] font-mono font-semibold tracking-wider uppercase opacity-80">
                    {ins.type === "recommendation" ? "RECOMMENDATION" : "DEEP ANALYSIS"}
                  </div>
                  <div className="text-[10px] leading-relaxed opacity-90">
                    <span className="font-semibold">{ins.title}</span>
                    <br />
                    {ins.body}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
