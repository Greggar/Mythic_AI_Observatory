"""GSM-Symbolic reasoning-fragility probe.

Runs small arithmetic word problems in three surface variants against one or
more model configs, mirroring Mirzadeh et al. (arXiv:2410.05229):

  base     — the problem as-authored (fixed numbers, GSM-8K-flavored)
  symbolic — same structure, re-rolled names + numbers, answer recomputed
  noop     — base text + an irrelevant distractor premise, answer unchanged

For every cell we capture the *mechanistic* signals that the reasoning
observatory already exposes on real traces:

  - exactness: model answer vs ground truth
  - token entropy (mean / p95 / median 2^H) from top-k logprobs
    (OpenAI-compat nodes; None on Ollama which drops logprobs)
  - DDC prompt margin from the embedding classifier

The fragility signature is the variant accuracy drop (symbolic−base,
noop−base) plus any entropy/margin shift when only the surface changes.
"""

import asyncio
import logging
import random
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from pydantic import BaseModel, Field

from services.ddc_embeddings import classify_ddc
from services.orchestrator import _call_model

logger = logging.getLogger("conductor")

PROBE_SEMAPHORE = asyncio.Semaphore(2)

_SYSTEM = (
    "Solve the word problem step by step. Show your working, then conclude "
    "with only the final numeric answer as a number on its own line."
)

_NAME_POOL = ["Priya", "Emilia", "Marcus", "Yuki", "Diego", "Sofia", "Leila", "Tomas"]
_ITEM_POOL = ["bracelets", "posters", "cookies", "keychains", "drawings", "scarves"]
_NOOP_POOL = [
    lambda r: f"There are {r.choice([120, 340, 560, 900, 1240])} {r.choice(['other stalls', 'residents', 'tables', 'vendors', 'houses'])} in the town, but they are not part of this problem.",
    lambda r: f"It is a {r.choice(['sunny', 'rainy', 'windy', 'cloudy'])} {r.choice(['Tuesday', 'Friday', 'Saturday'])} morning, and the weather does not change any of the numbers.",
    lambda r: f"Meanwhile {r.choice(['a neighbor', 'a passerby', 'someone nearby'])} carries {r.choice([7, 11, 15, 23])} {r.choice(['coins', 'tokens', 'pennies'])} in {r.choice(['a pocket', 'a bag', 'a wallet'])}, which is irrelevant to the question.",
]

# Each template: {id, base(symbolic: bool, rng) -> (text, answer)}
TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "clips",
        "title": "Half-as-many second month",
        "base": lambda s, r: _t_clips(s, r),
    },
    {
        "id": "fruit",
        "title": "Total fruit count",
        "base": lambda s, r: _t_fruit(s, r),
    },
    {
        "id": "train",
        "title": "Constant-speed distance",
        "base": lambda s, r: _t_train(s, r),
    },
    {
        "id": "pencils",
        "title": "Per-student pencils",
        "base": lambda s, r: _t_pencils(s, r),
    },
    {
        "id": "baker",
        "title": "Loaves sold twice-over",
        "base": lambda s, r: _t_baker(s, r),
    },
]


def _t_clips(symbolic: bool, rng: random.Random) -> tuple[str, float]:
    if symbolic:
        n = rng.choice(_NAME_POOL)
        item = rng.choice(_ITEM_POOL)
        x = rng.choice([36, 42, 54, 60, 72, 84])
        m1 = rng.choice(["April", "June", "September", "October"])
        m2 = rng.choice(["May", "July", "November"])
    else:
        n, item, x, m1, m2 = "Natalia", "clips", 48, "April", "May"
    text = (
        f"{n} sold {item} to {x} of her friends in {m1}, and then she sold half "
        f"as many {item} in {m2}. How many {item} did {n} sell altogether in {m1} and {m2}?"
    )
    return text, float(x + x // 2)


def _t_fruit(symbolic: bool, rng: random.Random) -> tuple[str, float]:
    if symbolic:
        n = rng.choice(_NAME_POOL)
        a, b, c = rng.choice([(7, 11, 15), (9, 14, 18), (12, 8, 21), (6, 19, 13)])
    else:
        n, a, b, c = "Tom", 5, 7, 9
    text = (
        f"{n} has {a} apples, {b} oranges, and {c} bananas. "
        f"How many pieces of fruit does {n} have in total?"
    )
    return text, float(a + b + c)


def _t_train(symbolic: bool, rng: random.Random) -> tuple[str, float]:
    if symbolic:
        city_a = rng.choice(["Berlin", "Lyon", "Oslo", "Bilbao", "Turin"])
        city_b = rng.choice(["Munich", "Nice", "Bergen", "Seville", "Milan"])
        while city_a == city_b:
            city_b = rng.choice(["Munich", "Nice", "Bergen", "Seville", "Milan"])
        d, h, h2 = rng.choice([(150, 2, 3), (180, 3, 2), (200, 4, 1), (120, 2, 4)])
    else:
        city_a, city_b, d, h, h2 = "Lynbrook", "Oakdale", 120, 2, 3
    text = (
        f"A train travels {d} miles from {city_a} to {city_b} in {h} hours, then "
        f"continues at the same speed for {h2} more hours. "
        f"How many miles has the train traveled in total?"
    )
    return text, float((d / h) * (h + h2))


def _t_pencils(symbolic: bool, rng: random.Random) -> tuple[str, float]:
    if symbolic:
        n = rng.choice(["Ms.", "Mr.", "Dr."] + ["Prof."]) + " " + rng.choice(["Akers", "Liu", "Nguyen", "Bravo", "Hansen"])
        g, b, p = rng.choice([(9, 12, 3), (14, 8, 4), (11, 16, 2), (18, 6, 5)])
    else:
        n, g, b, p = "Ms. Chen", 9, 12, 3
    text = (
        f"There are {g} girls and {b} boys in {n}'s class. "
        f"Each student has {p} pencils. How many pencils are in the class in total?"
    )
    return text, float((g + b) * p)


def _t_baker(symbolic: bool, rng: random.Random) -> tuple[str, float]:
    if symbolic:
        n = rng.choice(_NAME_POOL)
        lo, s = rng.choice([(100, 20), (90, 12), (140, 25), (120, 18)])
    else:
        n, lo, s = "Otto", 100, 20
    text = (
        f"A baker named {n} makes {lo} loaves of bread. He sells {s} loaves in the "
        f"morning and twice as many in the afternoon. How many loaves does he have left?"
    )
    return text, float(lo - s - 2 * s)


def _extract_answer(text: str) -> float | None:
    """Best-guess answer extraction.

    Prefers an explicit answer/total/result line; otherwise the last 'real'
    number in the response, skipping list markers like '1.' / '2)'.
    """
    if not text:
        return None
    m = re.search(r"(?i)(?:final\s+answer|answer|total|result)[^\n\d]*[:.\-]?\s*([+-]?\d+(?:\.\d+)?)", text)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            pass
    nums = list(re.finditer(r"[+-]?\d+(?:\.\d+)?", text))
    for mm in reversed(nums):
        nxt = text[mm.end():mm.end() + 1]
        line_start = text.rfind("\n", 0, mm.start()) + 1
        if mm.start() == line_start and nxt in ". )":
            continue
        try:
            return float(mm.group(0))
        except ValueError:
            continue
    return None


def _mentions_exact(text: str, value: float) -> bool:
    """True if the response contains the expected value as a standalone number."""
    num = str(int(value)) if float(value).is_integer() else str(value)
    return re.search(rf"(?<!\d){re.escape(num)}(?!\d)", text) is not None


def _noop_clause(rng: random.Random) -> str:
    pick = rng.choice(_NOOP_POOL)
    return pick(rng)


class ProbeCell(BaseModel):
    cell_id: str
    model: str
    provider: str
    template_id: str
    title: str
    variant: str  # base | symbolic | noop
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
    ddc_margin: float | None = None
    tokens: int | None = None


class ReasoningProbeStatus(BaseModel):
    run_id: str
    status: str = "running"  # running | done
    started_at: str
    seed: int
    models: list[dict[str, str]] = Field(default_factory=list)
    total: int = 0
    completed: int = 0
    failed: int = 0
    cells: list[ProbeCell] = Field(default_factory=list)


_probe_store: dict[str, ReasoningProbeStatus] = {}


def get_reasoning_probe(run_id: str) -> ReasoningProbeStatus | None:
    return _probe_store.get(run_id)


def _generate_narrative(rows: list[dict[str, Any]]) -> str:
    """Build a plain-English interpretation of the probe results."""
    if not rows:
        return "No results to interpret."

    parts: list[str] = []

    parts.append(
        "**What the probe tests:** Each arithmetic word problem runs in three "
        "surface variants — **base** (original), **symbolic** (re-rolled names "
        "+ numbers, answer recomputed), and **noop** (base + an irrelevant "
        "distractor sentence). The fragility signature (GSM-Symbolic, Mirzadeh "
        "et al. arXiv:2410.05229) is when a model gets base right but drops on "
        "symbolic, meaning it memorised the surface pattern rather than reasoning."
    )

    for row in rows:
        model = row.get("model", "unknown")
        base = row.get("base", {})
        sym = row.get("symbolic", {})
        noop = row.get("noop", {})
        base_acc = base.get("accuracy")
        sym_acc = sym.get("accuracy")
        noop_acc = noop.get("accuracy")
        drop_sym = row.get("drop_symbolic", 0)
        drop_noop = row.get("drop_noop", 0)
        n = base.get("n", 0)

        if base_acc is None:
            parts.append(f"**{model}:** No base accuracy data — cannot interpret.")
            continue

        fragility = drop_sym > 0 or drop_noop > 0

        # Accuracy interpretation
        if not fragility:
            parts.append(
                f"**{model}:** {n} problems tested. **{round(base_acc*100)}% base / "
                f"{round((sym_acc or 0)*100)}% symbolic / {round((noop_acc or 0)*100)}% noop** "
                f"— **0% fragility drop.** The model is computing, not pattern-matching. "
                f"It handles re-rolled numbers and irrelevant distractors without error."
            )
        else:
            sym_pct = round((drop_sym or 0) * 100)
            noop_pct = round((drop_noop or 0) * 100)
            verdict = (
                f"**{model}:** {n} problems tested. "
                f"**{round(base_acc*100)}% base / {round((sym_acc or 0)*100)}% symbolic / "
                f"{round((noop_acc or 0)*100)}% noop** — "
                f"**−{sym_pct}% symbolic, −{noop_pct}% noop.** "
            )
            if sym_pct >= 20:
                verdict += (
                    "Strong fragility signal — the model relies heavily on surface "
                    "patterns and struggles when names/numbers change."
                )
            elif sym_pct >= 5:
                verdict += (
                    "Moderate fragility — partial surface dependence. "
                    "Reasoning degrades when the problem looks unfamiliar."
                )
            else:
                verdict += (
                    "Mild fragility — mostly robust but occasional surface-dependent errors."
                )
            parts.append(verdict)

        # Entropy shift
        h_base = base.get("entropy_mean")
        h_sym = sym.get("entropy_mean")
        h_noop = noop.get("entropy_mean")
        if h_base is not None and h_sym is not None:
            delta_h = h_sym - h_base
            direction = "more" if delta_h > 0 else "less"
            magnitude = abs(delta_h)
            if magnitude > 0.05:
                parts.append(
                    f"Entropy shifts: symbolic is {direction} uncertain "
                    f"(ΔH = {delta_h:+.4f}) — {'the model is more confused by re-rolled variants.' if delta_h > 0 else 'the model is actually more confident on re-rolled variants, suggesting the new numbers are simpler.'}"
                )
            elif magnitude > 0.01:
                parts.append(
                    f"Entropy shift is mild (ΔH = {delta_h:+.4f}) — surface changes "
                    f"{'slightly increase' if delta_h > 0 else 'slightly decrease'} "
                    f"model uncertainty."
                )

        # DDC margin shift
        m_base = base.get("ddc_margin")
        m_sym = sym.get("ddc_margin")
        if m_base is not None and m_sym is not None:
            m_delta = m_sym - m_base
            if abs(m_delta) > 0.01:
                parts.append(
                    f"DDC margin shifts from {m_base:.3f} (base) to {m_sym:.3f} (symbolic) "
                    f"— {'the re-rolled text is harder for the embedding classifier to categorise.' if m_delta < 0 else 'the re-rolled text reads more clearly to the classifier.'} "
                    f"This tells us the surface change shifts how the text 'reads' even when reasoning is robust."
                )

    # Comparative insight
    if len(rows) > 1:
        fragiles = [r for r in rows if (r.get("drop_symbolic", 0) or 0) > 0.05]
        robust = [r for r in rows if (r.get("drop_symbolic", 0) or 0) == 0]
        if fragiles and robust:
            frag_names = ", ".join(r["model"] for r in fragiles)
            robust_names = ", ".join(r["model"] for r in robust)
            parts.append(
                f"**Cross-model:** {robust_names} show{'s' if len(robust)==1 else ''} robust reasoning; "
                f"{frag_names} show{'s' if len(fragiles)==1 else ''} surface dependence — "
                f"a direct comparison of reasoning quality on identical problems."
            )

    # When it gets interesting
    parts.append(
        "**When it gets interesting:** Weaker models or harder templates "
        "(e.g. the 'baker' loaves problem) will show base ≈ 100% but "
        "symbolic ≈ 60–80% — that's the fragility signature. "
        "The entropy and margin channels reveal *why*: the model's uncertainty "
        "spikes or its embedding-space reading of the problem shifts, even when "
        "the numerical structure is identical."
    )

    return "\n\n".join(parts)


def aggregate_reasoning_probe(run_id: str) -> dict[str, Any]:
    """Per-model × variant accuracy + mechanistic averages + fragility drops."""
    run = _probe_store.get(run_id)
    if not run:
        return {}
    models = sorted({c.model for c in run.cells})
    variants = ["base", "symbolic", "noop"]
    rows: list[dict[str, Any]] = []
    for model in models:
        row: dict[str, Any] = {"model": model}
        for v in variants:
            cells = [c for c in run.cells if c.model == model and c.variant == v]
            done = [c for c in cells if c.correct is not None]
            n = len(done)
            acc = (sum(1 for c in done if c.correct) / n) if n else None
            ents = [c.entropy_mean for c in done if c.entropy_mean is not None]
            brs = [c.median_branching for c in done if c.median_branching is not None]
            mgs = [c.ddc_margin for c in done if c.ddc_margin is not None]
            row[v] = {
                "n": n,
                "accuracy": round(acc, 3) if acc is not None else None,
                "entropy_mean": round(sum(ents) / len(ents), 4) if ents else None,
                "median_branching": round(sum(brs) / len(brs), 4) if brs else None,
                "ddc_margin": round(sum(mgs) / len(mgs), 4) if mgs else None,
            }
        if row.get("base") and row["base"].get("accuracy") is not None:
            base_acc = row["base"]["accuracy"]
            row["drop_symbolic"] = round(base_acc - (row["symbolic"]["accuracy"] or 0.0), 3)
            row["drop_noop"] = round(base_acc - (row["noop"]["accuracy"] or 0.0), 3)
        rows.append(row)
    narrative = _generate_narrative(rows)
    return {"run_id": run_id, "status": run.status, "rows": rows, "narrative": narrative}


async def _run_cell(cell: ProbeCell, rng: random.Random) -> None:
    try:
        async with PROBE_SEMAPHORE:
            result, eval_count, _duration, entropy = await _call_model(
                cell.model,
                cell.prompt,
                system=_SYSTEM,
                model_name_override=cell.model,
                provider_override=cell.provider,
            )
        cell.response = (result or "")[:600]
        cell.tokens = eval_count
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
        try:
            meta = await classify_ddc(cell.prompt, None)
            entry = meta.prompt if meta else None
            if entry and entry.top_scores and len(entry.top_scores) >= 2:
                s0 = float(entry.top_scores[0].get("score") or 0.0)
                s1 = float(entry.top_scores[1].get("score") or 0.0)
                cell.ddc_margin = round(s0 - s1, 4)
        except Exception as e:  # embedding classifier is best-effort
            logger.debug("reasoning probe ddc margin failed: %s", e)
        cell.status = "complete"
    except Exception as e:
        logger.error("reasoning probe cell %s failed: %s", cell.cell_id, e)
        cell.status = "error"
        cell.error = str(e)[:200]


async def _process_probe(run_id: str) -> None:
    run = _probe_store[run_id]
    rng = random.Random(run.seed)
    tasks = [asyncio.ensure_future(_run_cell(c, rng)) for c in run.cells]
    await asyncio.gather(*tasks, return_exceptions=True)
    run.completed = sum(1 for c in run.cells if c.status == "complete")
    run.failed = sum(1 for c in run.cells if c.status == "error")
    run.status = "done"


def start_reasoning_probe(
    models: list[dict[str, str]],
    template_ids: list[str] | None = None,
    seed: int | None = None,
) -> ReasoningProbeStatus:
    """Build and launch a probe run. Returns the store status immediately."""
    rng = random.Random(seed)
    templates = TEMPLATES
    if template_ids:
        wanted = set(template_ids)
        templates = [t for t in TEMPLATES if t["id"] in wanted]

    cells: list[ProbeCell] = []
    for tpl in templates:
        for cfg in models:
            for variant in ("base", "symbolic", "noop"):
                if variant == "noop":
                    base_text, base_answer = tpl["base"](False, rng)
                    text = base_text + " " + _noop_clause(rng)
                    answer = base_answer
                else:
                    text, answer = tpl["base"](variant == "symbolic", rng)
                cells.append(ProbeCell(
                    cell_id=uuid.uuid4().hex[:10],
                    model=cfg["model"],
                    provider=cfg["provider"],
                    template_id=tpl["id"],
                    title=tpl["title"],
                    variant=variant,
                    prompt=text,
                    expected=answer,
                ))

    run_id = uuid.uuid4().hex[:12]
    run = ReasoningProbeStatus(
        run_id=run_id,
        status="running",
        started_at=datetime.now(timezone.utc).isoformat(),
        seed=seed if seed is not None else rng.randrange(1 << 30),
        models=models,
        total=len(cells),
        cells=cells,
    )
    _probe_store[run_id] = run
    asyncio.create_task(_process_probe(run_id)).add_done_callback(
        lambda fut: fut.result() if not fut.cancelled() and fut.exception() else None
    )
    return run
