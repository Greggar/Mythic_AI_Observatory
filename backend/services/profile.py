from statistics import median

from pydantic import BaseModel

from models.trace import TraceSession


class ModelProfile(BaseModel):
    model: str
    trace_count: int
    avg_latency_ms: float
    p50_latency_ms: float
    p95_latency_ms: float
    p99_latency_ms: float
    avg_eval_count: float | None = None
    failure_rate: float
    avg_confidence: float | None = None
    stage_avgs: dict[str, float]  # stage_label -> avg_duration_ms
    avg_steps: float  # avg number of steps per trace


def _percentile(sorted_data: list[float], p: float) -> float:
    """Linear-interpolated percentile, works for any dataset size >= 1."""
    n = len(sorted_data)
    if n == 0:
        return 0
    if n == 1:
        return sorted_data[0]
    k = (p / 100.0) * (n - 1)
    f = int(k)
    c = k - f
    if f + 1 < n:
        return sorted_data[f] * (1 - c) + sorted_data[f + 1] * c
    return sorted_data[f]


def compute_profile() -> list[ModelProfile]:
    from services.orchestrator import load_history

    traces = load_history(limit=500)
    if not traces:
        return []

    by_model: dict[str, list[TraceSession]] = {}
    for t in traces:
        model = t.model_used or "unknown"
        by_model.setdefault(model, []).append(t)

    profiles: list[ModelProfile] = []
    stage_order = [
        "step-1", "step-2", "step-3", "step-4",
        "step-5", "step-6", "step-7",
    ]

    for model, group in by_model.items():
        total_durations = []
        eval_counts: list[int] = []
        errors = 0
        confidences: list[float] = []
        stage_durs: dict[str, list[float]] = {s: [] for s in stage_order}

        for t in group:
            dur = sum(s.duration_ms or 0 for s in t.steps)
            total_durations.append(dur)

            if t.status == "error":
                errors += 1

            if t.confidence is not None:
                confidences.append(t.confidence)

            for s in t.steps:
                if s.id in stage_durs and s.duration_ms is not None:
                    stage_durs[s.id].append(s.duration_ms)
                if s.eval_count is not None:
                    eval_counts.append(s.eval_count)

        sorted_durs = sorted(total_durations)
        p50 = median(total_durations) if total_durations else 0
        p95 = _percentile(sorted_durs, 95) if sorted_durs else 0
        p99 = _percentile(sorted_durs, 99) if sorted_durs else 0

        profiles.append(ModelProfile(
            model=model,
            trace_count=len(group),
            avg_latency_ms=sum(total_durations) / len(total_durations) if total_durations else 0,
            p50_latency_ms=p50,
            p95_latency_ms=p95,
            p99_latency_ms=p99,
            avg_eval_count=sum(eval_counts) / len(eval_counts) if eval_counts else None,
            failure_rate=errors / len(group) if group else 0,
            avg_confidence=sum(confidences) / len(confidences) if confidences else None,
            stage_avgs={
                sid: (sum(ds) / len(ds)) if ds else 0
                for sid, ds in stage_durs.items()
            },
            avg_steps=sum(len(t.steps) for t in group) / len(group) if group else 0,
        ))

    return profiles
