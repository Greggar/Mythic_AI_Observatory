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
  context_assembled: string | null;
}

export interface TelemetryImpact {
  peak_cpu: number;
  peak_mem: number;
  avg_cpu: number;
  avg_mem: number;
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
}
