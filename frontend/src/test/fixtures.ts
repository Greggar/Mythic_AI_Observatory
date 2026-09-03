import type { TraceSession, TraceStep } from "@/types/trace";

export function makeStep(label: string, extra: Record<string, unknown> = {}): TraceStep {
  return {
    id: `${label.toLowerCase().replace(/\s+/g, "-")}-1`,
    label,
    status: "complete",
    timestamp: new Date().toISOString(),
    duration_ms: 500,
    metadata: extra,
    model_used: null,
    agent_used: null,
    cpu_before: null,
    mem_before: null,
    cpu_after: null,
    mem_after: null,
    eval_count: 42,
    eval_duration_ns: 1_000_000_000,
    context_assembled: null,
  };
}

export function makeTrace(overrides: Partial<TraceSession> = {}): TraceSession {
  const output = "The red dust settles on a midnight plain, / where silent craters wait for morning rain.";
  return {
    id: "abc123",
    prompt: "Write a short poem about Mars.",
    output,
    confidence: 0.82,
    insight_tags: ["creative_request"],
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    model_used: "primary/qwen2.5:3b",
    agent_used: "default",
    telemetry_impact: null,
    status: "complete",
    steps: [
      makeStep("Request Received"),
      makeStep("Intent Classification", {
        intent_probs: [{ label: "creative", confidence: 0.9 }],
      }),
      makeStep("Model Routing"),
      makeStep("Memory Retrieval", {
        retrieved_chunks: [
          { trace_id: "t1", content: "A prior poem about planets.", relevance: 0.4, used: true },
        ],
      }),
      makeStep("Context Assembly", {
        output: "[Context Synthesis]: synthesized answer",
      }),
      makeStep("Response Generation", {
        output,
        gen_started_at: new Date().toISOString(),
      }),
      makeStep("Output Packaging"),
    ],
    ...overrides,
  };
}

export function makeSummaryEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "abc123",
    prompt: "Write a short poem about Mars.",
    status: "complete",
    created_at: new Date().toISOString(),
    output: "The red dust settles on a midnight plain.",
    steps: [{ duration_ms: 500 }],
    ddc: { prompt: { code: "8", label: "Literature" } },
    lcc: { prompt: { code: "P", label: "Language and Literature" } },
    ...overrides,
  };
}
