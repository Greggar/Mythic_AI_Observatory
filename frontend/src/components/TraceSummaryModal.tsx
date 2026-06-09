"use client";

import { useRef } from "react";
import { Printer, X } from "lucide-react";
import type { TraceSession } from "@/types/trace";
import TokenVelocityGraph from "./TokenVelocityGraph";

interface Props {
  trace: TraceSession;
  onClose: () => void;
}

function fmt(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const STAGE_DESCRIPTIONS: Record<string, string> = {
  "Request Received": "Raw prompt enters the system. Parsed and normalized before routing to the orchestration pipeline.",
  "Intent Classification": "Prompt is analysed to determine user goal, domain, and required capabilities. Routes to the correct agent or model.",
  "Agent Selection": "The most suitable agent or model is selected based on intent, resource availability, and capability requirements.",
  "Memory Retrieval": "Relevant context from past traces, annotations, and the vector store is retrieved to inform the current response.",
  "Context Synthesis": "Retrieved memory is merged with the system prompt and user input to form the complete context window for the model.",
  "Response Generation": "The selected model generates a response using the synthesised context. Streams tokens in real-time.",
  "Final Response": "Generated output is post-processed, formatted, and delivered. Insights and confidence are computed from the result.",
};

export default function TraceSummaryModal({ trace, onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  const totalDuration = trace.steps.reduce((s, st) => s + (st.duration_ms ?? 0), 0);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={printRef}
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#0a0a1a] border border-white/[0.08] p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
        style={{ fontFamily: "system-ui, monospace" }}
      >
        {/* header */}
        <div className="flex items-center justify-between print:hidden">
          <span className="text-[11px] font-semibold tracking-[0.28em] uppercase text-teal-mystic">
            Trace Summary — {trace.id}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono
                bg-teal-mystic/10 text-teal-mystic border border-teal-mystic/20
                hover:bg-teal-mystic/20 transition-colors"
            >
              <Printer size={12} /> Print
            </button>
            <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400 transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Orchestration Prompt */}
        <div className="space-y-1.5 print:break-inside-avoid">
          <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-500">
            Orchestration Prompt
          </div>
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
            <p className="text-xs text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap">{trace.prompt}</p>
          </div>
        </div>

        {/* Duration + Model + Tokens — three-column */}
        <div className="grid grid-cols-3 gap-3 print:break-inside-avoid">
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05] text-center">
            <div className="text-[8px] font-semibold tracking-widest uppercase text-zinc-600 mb-1">Duration</div>
            <div className="text-sm font-mono text-zinc-200">{fmt(totalDuration)}</div>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05] text-center">
            <div className="text-[8px] font-semibold tracking-widest uppercase text-zinc-600 mb-1">Model</div>
            <div className="text-sm font-mono text-zinc-200 truncate" title={trace.model_used || "—"}>
              {trace.model_used || "—"}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05] text-center">
            <div className="text-[8px] font-semibold tracking-widest uppercase text-zinc-600 mb-1">Confidence</div>
            <div className="text-sm font-mono text-zinc-200">{trace.confidence != null ? `${Math.round(trace.confidence * 100)}%` : "—"}</div>
          </div>
        </div>

        {/* Token Velocity */}
        <div className="space-y-1.5 print:break-inside-avoid">
          <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-500">
            Token Velocity
          </div>
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
            <TokenVelocityGraph steps={trace.steps} />
          </div>
        </div>

        {/* Orchestration Trace */}
        <div className="space-y-1 print:break-inside-avoid">
          <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-500">
            Orchestration Trace
          </div>
          <div className="space-y-2">
            {trace.steps.map((step, i) => (
              <div key={step.id} className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-zinc-300">{step.label}</span>
                  <span className="text-[10px] font-mono text-zinc-600">
                    {step.duration_ms != null ? fmt(step.duration_ms) : "—"}
                  </span>
                </div>
                <div className="mt-1 text-[9px] text-zinc-600 italic leading-relaxed">
                  {(STAGE_DESCRIPTIONS as Record<string, string>)[step.label] || ""}
                </div>
                {(step.metadata?.output as string | undefined) && (
                  <div className="mt-1 text-[9px] text-zinc-500 font-mono leading-relaxed">
                    {(step.metadata.output as string)}
                  </div>
                )}
                {step.context_assembled && (
                  <div className="mt-1.5 text-[9px] font-mono leading-relaxed whitespace-pre-wrap">
                    {step.context_assembled.split("\n").map((line, i) => {
                      const match = line.match(/^\[([^\]]+)\]:\s*(.*)/);
                      if (match) {
                        return (
                          <div key={i}>
                            <span className="text-teal-mystic/60">[{match[1]}]</span>
                            <span className="text-zinc-600">: {match[2]}</span>
                          </div>
                        );
                      }
                      return <div key={i} className="text-zinc-500">{line}</div>;
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Latency — simplified bars */}
        <div className="space-y-1.5 print:break-inside-avoid">
          <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-500">
            Step Latency
          </div>
          <div className="space-y-1">
            {trace.steps.map((step) => {
              const maxDur = Math.max(...trace.steps.map((s) => s.duration_ms ?? 0), 1);
              const pct = maxDur > 0 ? ((step.duration_ms ?? 0) / maxDur) * 100 : 0;
              return (
                <div key={step.id} className="flex items-center gap-2">
                  <span className="text-[8px] text-zinc-500 w-[88px] shrink-0 truncate font-mono">{step.label}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-white/[0.04] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-teal-500"
                      style={{ width: `${Math.max(pct, 1)}%`, opacity: 0.6 + 0.4 * (pct / 100) }}
                    />
                  </div>
                  <span className="text-[9px] font-mono text-zinc-500 w-12 text-right shrink-0">
                    {step.duration_ms != null ? fmt(step.duration_ms) : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Insights */}
        {trace.llm_insights && trace.llm_insights.length > 0 && (
          <div className="space-y-1.5 print:break-inside-avoid">
            <div className="text-[9px] font-semibold tracking-widest uppercase text-zinc-500">
              Insights
            </div>
            <div className="space-y-1.5">
              {trace.llm_insights.map((insight, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                  <div className="text-[9px] font-semibold text-violet-glow/70">{insight.title}</div>
                  <div className="mt-0.5 text-[9px] text-zinc-500 font-mono leading-relaxed">{insight.body}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Response rationale */}
        {trace.response_rationale && (
          <div className="space-y-1.5 print:break-inside-avoid">
            <div className="text-[9px] font-semibold tracking-widest uppercase text-violet-glow/70">
              Why This Response?
            </div>
            <div className="p-3 rounded-xl bg-violet-glow/[0.04] border border-violet-glow/[0.1]">
              <div className="text-[10px] text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap">
                {trace.response_rationale}
              </div>
            </div>
          </div>
        )}

        {/* Trace explanation */}
        {trace.trace_explanation && (
          <div className="space-y-1.5 print:break-inside-avoid">
            <div className="text-[9px] font-semibold tracking-widest uppercase text-teal-mystic/70">
              Trace Explanation
            </div>
            <div className="p-3 rounded-xl bg-teal-mystic/[0.04] border border-teal-mystic/[0.1]">
              <div className="text-[10px] text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap">
                {trace.trace_explanation}
              </div>
            </div>
          </div>
        )}

        <div className="text-[8px] text-zinc-700 text-center pt-2 border-t border-white/[0.04] print:m-0">
          Mythic AI Observatory — Generated at {new Date().toISOString().replace("T", " ").slice(0, 19)}
        </div>
      </div>
    </div>
  );
}
