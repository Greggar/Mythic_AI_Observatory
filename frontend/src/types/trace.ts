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
  score?: number;
  margin?: number;
  top_scores?: { code: string; label: string; score: number }[];
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
  score?: number;
  margin?: number;
  top_scores?: { code: string; label: string; score: number }[];
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

export interface SynesthClassification {
  input_probs: number[];
  output_probs: number[];
}

export interface TokenEntropy {
  mean_entropy: number | null;
  p95_entropy: number | null;
  mean_surprisal: number | null;
  high_entropy_count: number;
  token_count: number;
  top_k: number;
  series?: number[];
}

export interface TraceSession {
  id: string;
  prompt: string;
  batch_id?: string;
  test_batch_id?: string;
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
  token_entropy?: TokenEntropy;
  ddc?: DdcMetadata;
  lcc?: LccMetadata;
  synesth?: SynesthClassification;
}

export interface BatchError {
  trace_id: string;
  line: number;
  error: string;
}

export type ProbeAction = "classify";
export type ProbeAttribute = "ddc" | "lcc" | "intent" | "synesth_input" | "synesth_output";
export type ProbeArtefact = "prompt" | "response";

export interface Probe {
  action: ProbeAction;
  attribute: ProbeAttribute;
  artefact: ProbeArtefact;
}

export interface ProbeResult {
  label: string;
  value: string;
  confidence: number | null;
}

export const PROBE_ATTRIBUTE_LABELS: Record<ProbeAttribute, string> = {
  ddc: "DDC",
  lcc: "LCC",
  intent: "Intent",
  synesth_input: "Synesthesia Input",
  synesth_output: "Synesthesia Output",
};

export const PROBE_ARTEFACT_OPTIONS: Record<ProbeAttribute, ProbeArtefact[]> = {
  ddc: ["prompt", "response"],
  lcc: ["prompt", "response"],
  intent: ["prompt"],
  synesth_input: ["prompt"],
  synesth_output: ["response"],
};

export interface ModelOption {
  name: string;
  provider: "local" | "worker";
}

export interface TestModelConfig {
  provider: "local" | "worker";
  model: string;
}

export interface TestRunResult {
  config: TestModelConfig;
  trace_id: string;
  status: "running" | "complete" | "error";
  error: string | null;
}

export interface TestRunStatus {
  test_batch_id: string;
  total: number;
  completed: number;
  failed: number;
  status: "running" | "done";
  results: TestRunResult[];
}

export interface BatchStatus {
  batch_id: string;
  total: number;
  completed: number;
  failed: number;
  status: "running" | "done";
  trace_ids: string[];
  error_details: BatchError[];
  created_at: string;
}
