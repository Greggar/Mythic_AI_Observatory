from datetime import UTC, datetime
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
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
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


class TokenEntropy(BaseModel):
    """Response token-distribution uncertainty, computed from top-k logprobs.

    mean_entropy: average per-token entropy (bits) over the returned top-k
                  distribution (normalized). An estimate — the full vocab
                  mass beyond top-k is not observed.
    p95_entropy:  95th-percentile per-token entropy (bits).
    mean_surprisal: average -log2 p(sampled token) (bits) — how surprising the
                  chosen token was, distinct from entropy.
    high_entropy_count: tokens with entropy > threshold (default 1.5 bits).
    token_count:   number of non-special tokens scored.
    top_k:         how many candidate logprobs were requested per token.
    median_branching: median of 2**H over all scored tokens — how many
                  competing continuations were plausibly live at the median
                  token. ~1.0 = near-deterministic; >2 = a real fork.
    branching_series: 2**H per downsampled token, aligned with 'series'.
    """

    mean_entropy: float | None = None
    p95_entropy: float | None = None
    mean_surprisal: float | None = None
    high_entropy_count: int = 0
    token_count: int = 0
    top_k: int = 5
    series: list[float] = Field(default_factory=list)  # downsampled temporal entropy
    median_branching: float | None = None
    branching_series: list[float] = Field(default_factory=list)  # 2**H per token


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
    chat_id: str | None = None
    exchange_index: int | None = None
    status: str = "processing"  # processing | complete | error
    steps: list[TraceStep] = Field(default_factory=list)
    output: str | None = None
    confidence: float | None = None
    insight_tags: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    completed_at: str | None = None
    model_used: str | None = None
    agent_used: str | None = None
    telemetry_impact: TelemetryImpact | None = None
    llm_insights: list[LlmInsight] = Field(default_factory=list)
    embedding: list[float] | None = None
    response_rationale: str | None = None
    trace_explanation: str | None = None
    token_entropy: TokenEntropy | None = None
    ddc: DdcMetadata | None = None
    lcc: LccMetadata | None = None
    synesth: SynesthClassification | None = None
