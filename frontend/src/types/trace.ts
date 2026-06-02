export interface TraceStep {
  id: string;
  label: string;
  status: "pending" | "processing" | "complete" | "error";
  timestamp: string;
  duration_ms: number | null;
  metadata: Record<string, unknown>;
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
}
