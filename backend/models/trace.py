from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


class TraceStep(BaseModel):
    id: str
    label: str
    status: str  # pending | processing | complete | error
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    duration_ms: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


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
