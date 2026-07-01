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

interface SeenStats {
  min: number;
  max: number;
  count: number;
}

function fmt(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function assess(
  ms: number,
  seen: SeenStats | undefined,
): { verdict: "new" | "good" | "ok" | "bad"; message: string } {
  if (!seen) return { verdict: "new", message: "no prior traces to compare against" };
  const midpoint = (seen.min + seen.max) / 2;
  if (ms > seen.max) return { verdict: "bad", message: `exceeds session max (${fmt(seen.max)}, n=${seen.count})` };
  if (ms > midpoint) return { verdict: "ok", message: `above session midpoint (range ${fmt(seen.min)}–${fmt(seen.max)}, n=${seen.count})` };
  return { verdict: "good", message: `within session baseline (range ${fmt(seen.min)}–${fmt(seen.max)}, n=${seen.count})` };
}

function generate(
  trace: TraceSession,
  sessionSeen: Map<string, SeenStats>,
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
  const promptLen = (trace.prompt || "").length;

  for (const [label, ms] of stepMap) {
    const seen = sessionSeen.get(label);
    const { verdict, message } = assess(ms, seen);

    if (verdict === "bad") {
      const pct = totalMs > 0 ? ((ms / totalMs) * 100).toFixed(0) : "?";
      const reasons = [`${fmt(ms)} (${pct}% of run). ${message}.`];
      if (promptLen > 200) {
        reasons.push(`Prompt is ${promptLen} chars — longer inputs increase time.`);
      }
      insights.push({
        level: "critical",
        title: `${label} slow`,
        body: reasons.join(" "),
      });
    } else if (verdict === "ok") {
      insights.push({
        level: "warning",
        title: `${label} elevated`,
        body: `${fmt(ms)} — ${message}.`,
      });
    } else if (verdict === "good") {
      insights.push({
        level: "info",
        title: `${label} OK`,
        body: `${fmt(ms)} — ${message}.`,
      });
    } else {
      insights.push({
        level: "info",
        title: `${label} (new)`,
        body: `${fmt(ms)} — ${message}.`,
      });
    }
  }

  const hasWarning = insights.some(i => i.level === "critical" || i.level === "warning");

  if (totalSec < 5 && !hasWarning && insights.length > 0) {
    insights.push({
      level: "optimal",
      title: "Fast pipeline",
      body: "Completed in under 5s. All stages within session baseline.",
    });
  }

  const nonModelStages = ["Request Received", "Model Routing", "Memory Retrieval", "Output Packaging"];
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

  const isLocal =
    modelLabel === "local" || modelLabel.toLowerCase().includes("qwen");

  const allCounts = [...sessionSeen.values()];
  const totalDatapoints = allCounts.reduce((s, c) => s + c.count, 0);

  insights.push({
    level: "info",
    title: `${modelLabel}${isLocal ? " on CPU" : " on GPU"}`,
    body:
      `Prompt: ${promptLen} chars. ` +
      (totalDatapoints === 0
        ? "First trace — cold start expected."
        : `${totalDatapoints} prior data points across ${sessionSeen.size} stage types.`),
  });

  return insights;
}

export default function PerformanceInsights({ trace }: { trace: TraceSession | null }) {
  const sessionSeen = useRef(new Map<string, SeenStats>());

  const insights = useMemo(() => {
    if (!trace) return [];
    const result = generate(trace, sessionSeen.current);
    for (const step of trace.steps || []) {
      if (step.label && step.duration_ms != null) {
        const seen = sessionSeen.current.get(step.label);
        if (seen) {
          seen.min = Math.min(seen.min, step.duration_ms);
          seen.max = Math.max(seen.max, step.duration_ms);
          seen.count += 1;
        } else {
          sessionSeen.current.set(step.label, {
            min: step.duration_ms,
            max: step.duration_ms,
            count: 1,
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
