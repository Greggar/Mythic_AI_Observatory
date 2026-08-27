"""Complexity-ladder probe (Illusion of Thinking method).

Runs two problem generators at controllable complexity levels against one or
more model configs, reproducing the effort peak-then-decline finding from
Shojaee et al. (arXiv:2506.06941, NeurIPS 2025):

  arithmetic_chain — sequential +/- operations, complexity = operation count
  tower_of_hanoi   — minimum moves = 2^N - 1, complexity = disc count

Per cell we capture:
  - exactness: model answer vs ground truth
  - token entropy (mean / p95 / median 2^H) from top-k logprobs
  - token count (eval_count) as effort signal

Aggregated per-complexity: accuracy, mean tokens, mean entropy, mean branching
factor, efficiency ratio (actual / optimal tokens).  The accuracy curve shows
the three regimes; the effort curve shows the peak-then-decline signature.
"""

import asyncio
import logging
import math
import random
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

from services.orchestrator import _call_model

logger = logging.getLogger("conductor")

COMPLEXITY_SEMAPHORE = asyncio.Semaphore(2)

_SYSTEM = (
    "Solve the problem step by step. Show your working, then conclude "
    "with only the final numeric answer as a number on its own line."
)

# ── Generators ──────────────────────────────────────────────────────

_NAME_POOL = ["Priya", "Emilia", "Marcus", "Yuki", "Diego", "Sofia", "Leila", "Tomas"]
_PEG_A = ["Peg A", "Peg Alpha", "Peg One", "Rod A"]
_PEG_B = ["Peg B", "Peg Beta", "Peg Two", "Rod B"]
_PEG_C = ["Peg C", "Peg Gamma", "Peg Three", "Rod C"]


def _gen_arithmetic_chain(complexity: int, rng: random.Random) -> tuple[str, float]:
    """Sequential left-to-right addition/subtraction.

    Returns (question_text, correct_answer).  Intermediate results are kept
    non-negative by post-filtering.
    """
    ops: list[tuple[str, int]] = []
    value = rng.randint(5, 15)
    ops.append(("start", value))
    for _ in range(complexity):
        op = rng.choice(["+", "-"])
        operand = rng.randint(1, 15)
        if op == "-":
            # ensure non-negative intermediate
            operand = min(operand, value)
        else:
            pass  # addition always safe
        value = value + operand if op == "+" else value - operand
        ops.append((op, operand))

    parts = [f"Compute step by step: {ops[0][1]}"]
    for op, operand in ops[1:]:
        parts.append(f"{op} {operand}")
    question = " ".join(parts)

    # recompute answer deterministically
    ans = float(ops[0][1])
    for op, operand in ops[1:]:
        ans = ans + operand if op == "+" else ans - operand
    return question, ans


def _gen_tower_of_hanoi(complexity: int, rng: random.Random) -> tuple[str, float]:
    """Minimum moves = 2^N - 1.  Tests derivation vs formula recall."""
    n = complexity
    answer = float(2**n - 1)

    pa = rng.choice(_PEG_A)
    pb = rng.choice(_PEG_B)
    pc = rng.choice(_PEG_C)
    # ensure all distinct
    while pb == pa:
        pb = rng.choice(_PEG_B)
    while pc in (pa, pb):
        pc = rng.choice(_PEG_C)

    if n >= 6:
        text = (
            f"What is the minimum number of moves to solve Tower of Hanoi with "
            f"{n} discs on {pa}, {pb}, and {pc}?  Show the recursive reasoning "
            f"step by step — do not just state a formula."
        )
    else:
        text = (
            f"What is the minimum number of moves to solve Tower of Hanoi with "
            f"{n} discs?"
        )
    return text, answer


GENERATORS = {
    "arithmetic_chain": _gen_arithmetic_chain,
    "tower_of_hanoi": _gen_tower_of_hanoi,
}

# Complexity ranges: arithmetic 2-10, hanoi 2-8
COMPLEXITY_RANGES = {
    "arithmetic_chain": list(range(2, 11)),
    "tower_of_hanoi": list(range(2, 9)),
}

INSTANCES_PER_LEVEL = {
    "arithmetic_chain": 5,
    "tower_of_hanoi": 3,
}

OPTIMAL_TOKENS = {
    "arithmetic_chain": lambda c: 3 * c + 6,  # ~3 tokens per op + preamble
    "tower_of_hanoi": lambda c: max(12, 6 * c),  # grows with disc count
}


# ── Data models ─────────────────────────────────────────────────────

class ComplexityCell(BaseModel):
    cell_id: str
    model: str
    provider: str
    generator: str  # arithmetic_chain | tower_of_hanoi
    complexity: int
    instance: int  # 0-based within same complexity
    prompt: str = ""
    expected: float | None = None
    response: str = ""
    parsed: float | None = None
    correct: bool | None = None
    status: str = "running"  # running | complete | error
    error: str | None = None
    entropy_mean: float | None = None
    entropy_p95: float | None = None
    median_branching: float | None = None
    tokens: int | None = None
    optimal_tokens: int | None = None


class ComplexityProbeStatus(BaseModel):
    run_id: str
    status: str = "running"  # running | done
    started_at: str
    seed: int
    models: list[dict[str, str]] = Field(default_factory=list)
    generators: list[str] = Field(default_factory=list)
    total: int = 0
    completed: int = 0
    failed: int = 0
    cells: list[ComplexityCell] = Field(default_factory=list)


_probe_store: dict[str, ComplexityProbeStatus] = {}


def get_complexity_probe(run_id: str) -> ComplexityProbeStatus | None:
    return _probe_store.get(run_id)


# ── Answer extraction ───────────────────────────────────────────────

def _extract_answer(text: str) -> float | None:
    """Best-guess answer extraction — same logic as reasoning_probe."""
    if not text:
        return None
    m = re.search(
        r"(?i)(?:final\s+answer|answer|total|result|minimum)[^\n\d]*[:.\-]?\s*([+-]?\d+(?:\.\d+)?)",
        text,
    )
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            pass
    nums = list(re.finditer(r"[+-]?\d+(?:\.\d+)?", text))
    for mm in reversed(nums):
        nxt = text[mm.end() : mm.end() + 1]
        line_start = text.rfind("\n", 0, mm.start()) + 1
        if mm.start() == line_start and nxt in ". )":
            continue
        try:
            return float(mm.group(0))
        except ValueError:
            continue
    return None


def _mentions_exact(text: str, value: float) -> bool:
    num = str(int(value)) if float(value).is_integer() else str(value)
    return re.search(rf"(?<!\d){re.escape(num)}(?!\d)", text) is not None


# ── Cell runner ─────────────────────────────────────────────────────

async def _run_cell(cell: ComplexityCell) -> None:
    try:
        async with COMPLEXITY_SEMAPHORE:
            result, eval_count, _duration, entropy = await _call_model(
                cell.model,
                cell.prompt,
                system=_SYSTEM,
                model_name_override=cell.model,
                provider_override=cell.provider,
            )
        cell.response = (result or "")[:800]
        cell.tokens = eval_count
        # Detect error responses from _call_model (returns "[model error: ...]")
        if cell.response.startswith("[") and "error:" in cell.response:
            cell.status = "error"
            cell.error = cell.response[:200]
            return
        if entropy:
            cell.entropy_mean = entropy.get("mean_entropy")
            cell.entropy_p95 = entropy.get("p95_entropy")
            cell.median_branching = entropy.get("median_branching")
        if cell.expected is not None and _mentions_exact(result, cell.expected):
            cell.parsed = cell.expected
            cell.correct = True
        else:
            parsed = _extract_answer(result)
            cell.parsed = parsed
            if parsed is not None and cell.expected is not None:
                cell.correct = abs(parsed - cell.expected) < 1e-9
        cell.status = "complete"
    except Exception as e:
        logger.error("complexity probe cell %s failed: %s", cell.cell_id, e)
        cell.status = "error"
        cell.error = str(e)[:200]


# ── Run orchestration ───────────────────────────────────────────────

async def _process_probe(run_id: str) -> None:
    run = _probe_store[run_id]
    tasks = [asyncio.ensure_future(_run_cell(c)) for c in run.cells]
    await asyncio.gather(*tasks, return_exceptions=True)
    run.completed = sum(1 for c in run.cells if c.status == "complete")
    run.failed = sum(1 for c in run.cells if c.status == "error")
    run.status = "done"


def start_complexity_probe(
    models: list[dict[str, str]],
    generators: list[str] | None = None,
    seed: int | None = None,
) -> ComplexityProbeStatus:
    """Build and launch a complexity-ladder probe run."""
    rng = random.Random(seed)
    gens = list(generators or ["arithmetic_chain", "tower_of_hanoi"])
    gens = [g for g in gens if g in GENERATORS]

    cells: list[ComplexityCell] = []
    for gen_name in gens:
        gen_fn = GENERATORS[gen_name]
        for complexity in COMPLEXITY_RANGES[gen_name]:
            n_instances = INSTANCES_PER_LEVEL[gen_name]
            for inst in range(n_instances):
                text, answer = gen_fn(complexity, rng)
                opt = OPTIMAL_TOKENS[gen_name](complexity)
                for cfg in models:
                    cells.append(ComplexityCell(
                        cell_id=uuid.uuid4().hex[:10],
                        model=cfg["model"],
                        provider=cfg["provider"],
                        generator=gen_name,
                        complexity=complexity,
                        instance=inst,
                        prompt=text,
                        expected=answer,
                        optimal_tokens=opt,
                    ))

    run_id = uuid.uuid4().hex[:12]
    run = ComplexityProbeStatus(
        run_id=run_id,
        status="running",
        started_at=datetime.now(timezone.utc).isoformat(),
        seed=seed if seed is not None else rng.randrange(1 << 30),
        models=models,
        generators=gens,
        total=len(cells),
        cells=cells,
    )
    _probe_store[run_id] = run
    asyncio.create_task(_process_probe(run_id)).add_done_callback(
        lambda fut: fut.result() if not fut.cancelled() and fut.exception() else None
    )
    return run


# ── Aggregation ─────────────────────────────────────────────────────

def aggregate_complexity_probe(run_id: str) -> dict[str, Any]:
    """Per-generator per-complexity accuracy + effort signals."""
    run = _probe_store.get(run_id)
    if not run:
        return {}

    result: dict[str, Any] = {
        "run_id": run_id,
        "status": run.status,
        "generators": {},
    }

    for gen_name in run.generators:
        gen_cells = [c for c in run.cells if c.generator == gen_name]
        complexities = sorted({c.complexity for c in gen_cells})
        levels: list[dict[str, Any]] = []

        for cx in complexities:
            cx_cells = [c for c in gen_cells if c.complexity == cx]
            per_model: dict[str, dict[str, Any]] = {}
            for c in cx_cells:
                if c.model not in per_model:
                    per_model[c.model] = {"cells": [], "model": c.model}
                per_model[c.model]["cells"].append(c)

            level_data: dict[str, Any] = {
                "complexity": cx,
                "optimal_tokens": OPTIMAL_TOKENS[gen_name](cx),
                "models": {},
            }
            for model_name, md in per_model.items():
                done = [c for c in md["cells"] if c.correct is not None]
                n = len(done)
                acc = (sum(1 for c in done if c.correct) / n) if n else None
                tokens = [c.tokens for c in done if c.tokens is not None]
                ents = [c.entropy_mean for c in done if c.entropy_mean is not None]
                brs = [c.median_branching for c in done if c.median_branching is not None]
                opt = OPTIMAL_TOKENS[gen_name](cx)
                eff = (sum(tokens) / n / opt) if tokens and opt else None
                level_data["models"][model_name] = {
                    "n": n,
                    "accuracy": round(acc, 3) if acc is not None else None,
                    "mean_tokens": round(sum(tokens) / len(tokens), 1) if tokens else None,
                    "mean_entropy": round(sum(ents) / len(ents), 4) if ents else None,
                    "mean_branching": round(sum(brs) / len(brs), 4) if brs else None,
                    "efficiency_ratio": round(eff, 2) if eff is not None else None,
                }
            levels.append(level_data)
        result["generators"][gen_name] = levels

    result["narrative"] = _generate_narrative(result)
    return result


# ── Narrative ───────────────────────────────────────────────────────

def _generate_narrative(data: dict[str, Any]) -> str:
    """Plain-English interpretation of the complexity-ladder results."""
    parts: list[str] = []
    parts.append(
        "**What the probe tests:** Two generators at increasing complexity. "
        "**Arithmetic chain** — sequential +/- operations evaluated left-to-right "
        "(complexity = operation count, 2–10).  **Tower of Hanoi** — minimum "
        "moves = 2^N − 1 (complexity = disc count, 2–8).  "
        "The Illusion of Thinking (Shojaee et al. arXiv:2506.06941) predicts "
        "that reasoning effort (thinking tokens) rises with complexity, peaks, "
        "then declines near the collapse point — even with spare token budget."
    )

    for gen_name, levels in data.get("generators", {}).items():
        parts.append(f"### {gen_name.replace('_', ' ').title()}")
        for lv in levels:
            cx = lv["complexity"]
            opt = lv["optimal_tokens"]
            parts.append(f"\n**Complexity {cx}** (optimal ≈ {opt} tokens):")
            for model_name, md in lv.get("models", {}).items():
                acc = md.get("accuracy")
                mt = md.get("mean_tokens")
                ent = md.get("mean_entropy")
                eff = md.get("efficiency_ratio")
                if acc is None:
                    parts.append(f"  {model_name}: no completed cells")
                    continue
                acc_pct = round(acc * 100)
                line = f"  {model_name}: {acc_pct}% accuracy"
                if mt is not None:
                    line += f", ~{mt:.0f} tokens (efficiency {eff:.2f}×)" if eff else f", ~{mt:.0f} tokens"
                if ent is not None:
                    line += f", entropy {ent:.4f}"
                parts.append(line)

    # Check for peak-then-decline signature
    for gen_name, levels in data.get("generators", {}).items():
        models_with_tokens: dict[str, list[tuple[int, float]]] = {}
        for lv in levels:
            for model_name, md in lv.get("models", {}).items():
                mt = md.get("mean_tokens")
                if mt is not None:
                    models_with_tokens.setdefault(model_name, []).append((lv["complexity"], mt))
        for model_name, series in models_with_tokens.items():
            if len(series) < 3:
                continue
            tokens = [t for _, t in series]
            # simple peak detection
            peak_idx = tokens.index(max(tokens))
            if 0 < peak_idx < len(tokens) - 1:
                after_peak = tokens[peak_idx + 1:]
                if any(t < tokens[peak_idx] * 0.85 for t in after_peak):
                    parts.append(
                        f"**Effort peak detected for {model_name}** on {gen_name}: "
                        f"token count peaks at complexity {series[peak_idx][0]} "
                        f"({tokens[peak_idx]:.0f} tokens) then declines — "
                        f"the model spends fewer tokens on harder problems. "
                        f"This is the Shojaee et al. signature: reasoning effort "
                        f"collapses despite spare token budget."
                    )

    if len(data.get("generators", {})) > 1:
        parts.append(
            "**Cross-generator insight:** Arithmetic chains test linear scaling "
            "(the model either tracks state or it doesn't). Tower of Hanoi tests "
            "exponential scaling — at N ≥ 6, the model must derive 2^N − 1 rather "
            "than count moves. If accuracy holds on arithmetic but collapses on "
            "Hanoi, the model can handle sequential reasoning but fails at recursive "
            "derivation under complexity."
        )

    return "\n\n".join(parts)
