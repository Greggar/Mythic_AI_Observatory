from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


class LlmInsight(BaseModel):
    type: str  # "info" or "recommendation"
    title: str
    body: str


class TraceStep(BaseModel):
    id: str
    label: str
    status: str  # pending | processing | complete | error
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    duration_ms: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    model_used: str | None = None
    agent_used: str | None = None
    cpu_before: float | None = None
    mem_before: float | None = None
    cpu_after: float | None = None
    mem_after: float | None = None
    eval_count: int | None = None
    eval_duration_ns: int | None = None
    context_assembled: str | None = None


class DdcEntry(BaseModel):
    code: str  # e.g. "006.3"
    label: str  # e.g. "Artificial Intelligence"
    action: str | None = None  # e.g. "Programming", "Analysis", "Explanation"
    domain: str | None = None  # e.g. "Computer Science", "Economics"
    lineage: list[dict] = Field(default_factory=list)  # tier: {tier, code, label}
    score: float = 0.0  # cosine similarity of the winning category
    margin: float = 0.0  # score - runner_up_score (breathing room)
    top_scores: list[dict] = Field(default_factory=list)  # [{code, label, score}] top-5


class DdcMetadata(BaseModel):
    prompt: DdcEntry | None = None
    response: DdcEntry | None = None
    prompt_alternatives: list[DdcEntry] = Field(default_factory=list)
    response_alternatives: list[DdcEntry] = Field(default_factory=list)


class LccEntry(BaseModel):
    code: str  # e.g. "QA76"
    label: str  # e.g. "Computer Science"
    action: str | None = None
    domain: str | None = None
    lineage: list[dict] = Field(default_factory=list)
    score: float = 0.0  # cosine similarity of the winning category
    margin: float = 0.0  # score - runner_up_score
    top_scores: list[dict] = Field(default_factory=list)  # [{code, label, score}] top-5


class LccMetadata(BaseModel):
    prompt: LccEntry | None = None
    response: LccEntry | None = None
    prompt_alternatives: list[LccEntry] = Field(default_factory=list)
    response_alternatives: list[LccEntry] = Field(default_factory=list)


class SynesthClassification(BaseModel):
    input_probs: list[float]  # 5 scores 0.0-1.0: Direct Command, Factual Question, Creative Request, Simple Query, Complex Inquiry
    output_probs: list[float]  # 5 scores 0.0-1.0: Concise List/Facts, Prose Explanation, Creative/Verse, Bulleted List, Technical/Code


class TelemetryImpact(BaseModel):
    peak_cpu: float = 0.0
    peak_mem: float = 0.0
    avg_cpu: float = 0.0
    avg_mem: float = 0.0


class TraceSession(BaseModel):
    id: str
    prompt: str
    batch_id: str | None = None
    test_batch_id: str | None = None
    status: str = "processing"  # processing | complete | error
    steps: list[TraceStep] = Field(default_factory=list)
    output: str | None = None
    confidence: float | None = None
    insight_tags: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: str | None = None
    model_used: str | None = None
    agent_used: str | None = None
    telemetry_impact: TelemetryImpact | None = None
    llm_insights: list[LlmInsight] = Field(default_factory=list)
    embedding: list[float] | None = None
    response_rationale: str | None = None
    trace_explanation: str | None = None
    ddc: DdcMetadata | None = None
    lcc: LccMetadata | None = None
    synesth: SynesthClassification | None = None
