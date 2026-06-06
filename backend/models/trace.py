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
    context_assembled: str | None = None


class TelemetryImpact(BaseModel):
    peak_cpu: float = 0.0
    peak_mem: float = 0.0
    avg_cpu: float = 0.0
    avg_mem: float = 0.0


class TraceSession(BaseModel):
    id: str
    prompt: str
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
