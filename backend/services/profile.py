import re
from statistics import median

from pydantic import BaseModel

from models.trace import TraceSession


HEDGE_PATTERNS = re.compile(
    r"\b(?:I\s+(?:cannot|can\'t|don\'t|do not|think|suppose|guess|believe|imagine|would\s+say)"
    r"|generally\s+speaking"
    r"|it\'?s?\s+(?:worth\s+noting|important\s+to\s+note|possible|likely|unclear)"
    r"|as\s+an?\s+AI"
    r"|perhaps\s*$|maybe\s*$"
    r"|however,?\s+(?:this|that|it)"
    r"|it\s+depends"
    r"|to\s+my\s+knowledge"
    r"|I\'?m?\s+not\s+(?:sure|certain|qualified)"
    r"|that\s+said"
    r"|in\s+my\s+opinion"
    r"|strictly\s+speaking"
    r"|for\s+what\s+it\s+worth"
    r"|more\s+often\s+than\s+not"
    r"|in\s+general"
    r"|overall,?"
    r"|arguably"
    r"|presumably"
    r"|reportedly"
    r"|supposedly"
    r"|technically,?"
    r"|essentially"
    r"|basically"
    r"|frankly"
    r"|honestly"
    r"|admittedly"
    r")\b",
    re.IGNORECASE,
)

BULLET_RE = re.compile(r"^\s*[-*]\s")
TABLE_RE = re.compile(r"^\s*\|.*\|$")
CODE_FENCE_RE = re.compile(r"^```")


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
    stage_avgs: dict[str, float | None]  # stage_label -> avg_duration_ms (None = no data)
    avg_steps: float  # avg number of steps per trace

    # Personality metrics
    verbosity_score: float = 0.5  # 0=laconic, 1=prolix
    avg_output_tokens: float = 0
    formatting_bullet_pct: float = 0
    formatting_table_pct: float = 0
    formatting_code_pct: float = 0
    formatting_prose_pct: float = 1.0
    hedging_freq: float = 0  # occurrences per 1000 chars
    lexical_diversity: float = 0  # type-token ratio 0-1
    directness_score: float = 0.5  # 0=blunt, 1=discursive

    # Token entropy / decisiveness (bits per token, lower = more decisive)
    avg_token_entropy: float | None = None
    p95_token_entropy: float | None = None
    avg_surprisal: float | None = None
    entropy_trace_count: int = 0  # how many traces had entropy data


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


def _format_breakdown(text: str) -> dict[str, float]:
    """Classify lines into bullet / table / code / prose, return pct distribution."""
    lines = text.split("\n")
    in_code = False
    counts: dict[str, int] = {"bullet": 0, "table": 0, "code": 0, "prose": 0}
    for line in lines:
        if CODE_FENCE_RE.match(line):
            in_code = not in_code
            counts["code"] += 1
            continue
        if in_code:
            counts["code"] += 1
        elif BULLET_RE.match(line):
            counts["bullet"] += 1
        elif TABLE_RE.match(line):
            counts["table"] += 1
        else:
            stripped = line.strip()
            if stripped:
                counts["prose"] += 1
    total = sum(counts.values()) or 1
    return {k: v / total for k, v in counts.items()}


def _compute_personality(traces: list[TraceSession]) -> dict:
    outputs = [t.output for t in traces if t.output and t.status == "complete"]
    if not outputs:
        return {
            "verbosity_score": 0.5,
            "avg_output_tokens": 0,
            "formatting_bullet_pct": 0,
            "formatting_table_pct": 0,
            "formatting_code_pct": 0,
            "formatting_prose_pct": 1.0,
            "hedging_freq": 0,
            "lexical_diversity": 0,
            "directness_score": 0.5,
        }

    total_tokens = 0
    all_chars = 0
    hedge_count = 0
    total_words = 0
    unique_words: set[str] = set()
    first_sentence_chars = 0
    total_chars = 0
    format_acc: dict[str, float] = {"bullet": 0, "table": 0, "code": 0, "prose": 0}

    for out in outputs:
        words = out.split()
        total_tokens += len(words)
        all_chars += len(out)

        # Hedge
        matches = HEDGE_PATTERNS.findall(out)
        hedge_count += len(matches)

        # Lexical diversity (global across all outputs for stability)
        unique_words.update(w.lower() for w in words)
        total_words += len(words)

        # Directness: char position of first sentence boundary
        first_period = out.find(".")
        first_newline = out.find("\n")
        boundary = first_period if first_period >= 0 else len(out)
        if first_newline >= 0 and first_newline < boundary:
            boundary = first_newline
        first_sentence_chars += boundary
        total_chars += len(out)

        # Formatting
        fmt = _format_breakdown(out)
        for k in format_acc:
            format_acc[k] += fmt[k]

    n = len(outputs)
    avg_tokens = total_tokens / n
    tok_p90 = 300  # rough calibration: ~300 tokens = wordy boundary
    verbosity = min(avg_tokens / tok_p90, 1.0)

    fmt_final = {k: v / n for k, v in format_acc.items()}

    hedge_freq = (hedge_count / all_chars) * 1000 if all_chars else 0

    ttr = len(unique_words) / total_words if total_words else 0

    first_ratio = first_sentence_chars / total_chars if total_chars else 1
    directness = min(first_ratio * 2, 1.0)  # 0=blunt(<0.1), 1=discursive(>0.5)

    return {
        "verbosity_score": round(verbosity, 3),
        "avg_output_tokens": round(avg_tokens, 1),
        "formatting_bullet_pct": round(fmt_final["bullet"], 3),
        "formatting_table_pct": round(fmt_final["table"], 3),
        "formatting_code_pct": round(fmt_final["code"], 3),
        "formatting_prose_pct": round(fmt_final["prose"], 3),
        "hedging_freq": round(hedge_freq, 2),
        "lexical_diversity": round(ttr, 3),
        "directness_score": round(directness, 3),
    }


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
        entropies: list[float] = []
        surprisals: list[float] = []
        p95_entropies: list[float] = []

        for t in group:
            dur = sum(s.duration_ms or 0 for s in t.steps)
            total_durations.append(dur)

            if t.status == "error":
                errors += 1

            if t.confidence is not None:
                confidences.append(t.confidence)

            if t.token_entropy is not None:
                if t.token_entropy.mean_entropy is not None:
                    entropies.append(t.token_entropy.mean_entropy)
                if t.token_entropy.p95_entropy is not None:
                    p95_entropies.append(t.token_entropy.p95_entropy)
                if t.token_entropy.mean_surprisal is not None:
                    surprisals.append(t.token_entropy.mean_surprisal)

            for s in t.steps:
                if s.id in stage_durs and s.duration_ms is not None:
                    stage_durs[s.id].append(s.duration_ms)
                if s.eval_count is not None:
                    eval_counts.append(s.eval_count)

        sorted_durs = sorted(total_durations)
        p50 = median(total_durations) if total_durations else 0
        p95 = _percentile(sorted_durs, 95) if sorted_durs else 0
        p99 = _percentile(sorted_durs, 99) if sorted_durs else 0

        personality = _compute_personality(group)

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
                sid: (sum(ds) / len(ds)) if ds else None
                for sid, ds in stage_durs.items()
            },
            avg_steps=sum(len(t.steps) for t in group) / len(group) if group else 0,
            avg_token_entropy=sum(entropies) / len(entropies) if entropies else None,
            p95_token_entropy=sum(p95_entropies) / len(p95_entropies) if p95_entropies else None,
            avg_surprisal=sum(surprisals) / len(surprisals) if surprisals else None,
            entropy_trace_count=len(entropies),
            **personality,
        ))

    return profiles
