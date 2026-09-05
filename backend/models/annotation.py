from datetime import UTC, datetime

from pydantic import BaseModel, Field


class Annotation(BaseModel):
    id: str
    trace_id: str
    content: str
    tags: list[str] = Field(default_factory=list)
    rating: int | None = None
    author: str = "human"
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
