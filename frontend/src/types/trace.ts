export interface TraceStep {
  id: string;
  label: string;
  status: "pending" | "processing" | "complete" | "error";
  timestamp: string;
  duration_ms: number | null;
  metadata: Record<string, unknown>;
  model_used: string | null;
  agent_used: string | null;
  cpu_before: number | null;
  mem_before: number | null;
  cpu_after: number | null;
  mem_after: number | null;
  eval_count: number | null;
  eval_duration_ns: number | null;
  context_assembled: string | null;
}

export interface TelemetryImpact {
  peak_cpu: number;
  peak_mem: number;
  avg_cpu: number;
  avg_mem: number;
}

export interface DdcEntry {
  code: string;
  label: string;
  action: string | null;
  domain: string | null;
  lineage: { tier: number; code: string; label: string }[];
}

export interface DdcMetadata {
  prompt: DdcEntry | null;
  response: DdcEntry | null;
  prompt_alternatives?: DdcEntry[];
  response_alternatives?: DdcEntry[];
}

export interface LccEntry {
  code: string;
  label: string;
  action: string | null;
  domain: string | null;
  lineage: { tier: number; code: string; label: string }[];
}

export interface LccMetadata {
  prompt: LccEntry | null;
  response: LccEntry | null;
  prompt_alternatives?: LccEntry[];
  response_alternatives?: LccEntry[];
}

export interface LlmInsight {
  type: "info" | "recommendation";
  title: string;
  body: string;
}

export interface TraceSession {
  id: string;
  prompt: string;
  status: "processing" | "complete" | "error";
  steps: TraceStep[];
  output: string | null;
  confidence: number | null;
  insight_tags: string[];
  created_at: string;
  completed_at: string | null;
  model_used: string | null;
  agent_used: string | null;
  telemetry_impact: TelemetryImpact | null;
  llm_insights?: LlmInsight[];
  embedding?: number[];
  response_rationale?: string;
  trace_explanation?: string;
  ddc?: DdcMetadata;
}
