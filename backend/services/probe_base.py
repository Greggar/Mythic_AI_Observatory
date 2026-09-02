"""Shared machinery for async model-probe runs.

Consolidates the pieces that previously existed as two near-verbatim copies in
``reasoning_probe.py`` and ``complexity_probe.py``:

  - the shared solve-instruction and name pool
  - the answer-extraction / exact-mention heuristics
  - the in-memory run store binding, background dispatch, concurrency
    semaphore, and final completed/failed tally

The probe modules keep their domain models (specialized cell + status
subclasses), their problem generators, and their aggregation/narrative logic —
only the genuinely duplicated mechanics live here.  Adding a new probe kind
now means: subclass ``ProbeCell``/``ProbeRunStatus``, write an async cell
runner, and call ``launch_probe_run``.
"""

import asyncio
import logging
import re
from typing import Any, Awaitable, Callable, TypeVar

from pydantic import BaseModel, Field

logger = logging.getLogger("conductor")

# Shared solve instruction sent to the model for every probe cell.
SYSTEM_PROMPT = (
    "Solve the word problem step by step. Show your working, then conclude "
    "with only the final numeric answer as a number on its own line."
)

# Names used to re-roll symbolic variants.
NAME_POOL = ["Priya", "Emilia", "Marcus", "Yuki", "Diego", "Sofia", "Leila", "Tomas"]

# Default cell concurrency (matches the original per-probe semaphores).
DEFAULT_CONCURRENCY = 2


def extract_answer(text: str) -> float | None:
    """Best-guess answer extraction.

    Prefers an explicit answer/total/result line; otherwise the last 'real'
    number in the response, skipping list markers like '1.' / '2)'.
    """
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
        nxt = text[mm.end():mm.end() + 1]
        line_start = text.rfind("\n", 0, mm.start()) + 1
        if mm.start() == line_start and nxt in ". )":
            continue
        try:
            return float(mm.group(0))
        except ValueError:
            continue
    return None


def mentions_exact(text: str, value: float) -> bool:
    """True if the response contains the expected value as a standalone number."""
    num = str(int(value)) if float(value).is_integer() else str(value)
    return re.search(rf"(?<!\d){re.escape(num)}(?!\d)", text) is not None


# ── Base models ─────────────────────────────────────────────────────

class ProbeCell(BaseModel):
    """Shared cell fields across all probe kinds.

    Subclass to add kind-specific fields (variant, template, generator, ...).
    """

    cell_id: str
    model: str
    provider: str
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


S = TypeVar("S", bound="ProbeRunStatus")


class ProbeRunStatus(BaseModel):
    """Shared run envelope. Subclass and narrow ``cells`` to the cell kind."""

    run_id: str
    status: str = "running"  # running | done
    started_at: str
    seed: int
    models: list[dict[str, str]] = Field(default_factory=list)
    total: int = 0
    completed: int = 0
    failed: int = 0
    cells: list[ProbeCell] = Field(default_factory=list)


# ── Run orchestration ───────────────────────────────────────────────

def launch_probe_run(
    store: dict[str, S],
    run: S,
    runner: Callable[..., Awaitable[None]],
    *runner_args: Any,
    concurrency: int = DEFAULT_CONCURRENCY,
) -> S:
    """Register ``run`` in ``store`` and dispatch its cells in the background.

    ``runner`` is an async callable invoked as ``runner(cell, *runner_args)``
    for each cell; it mutates the cell's ``status``/``correct``/... fields and
    must not raise (bounded by this run's semaphore).  When every task has
    settled, ``completed``/``failed`` are tallied from cell status and the run
    is marked ``done``.  Returns ``run`` immediately for callers to return.
    """
    semaphore = asyncio.Semaphore(concurrency)

    async def _run_one(cell: ProbeCell) -> None:
        async with semaphore:
            await runner(cell, *runner_args)

    async def _process() -> None:
        tasks = [asyncio.ensure_future(_run_one(c)) for c in run.cells]
        await asyncio.gather(*tasks, return_exceptions=True)
        run.completed = sum(1 for c in run.cells if c.status == "complete")
        run.failed = sum(1 for c in run.cells if c.status == "error")
        run.status = "done"

    store[run.run_id] = run
    dispatch_background(_process, label=f"Probe run {run.run_id}")
    return run


def dispatch_background(
    coro_factory: Callable[[], Awaitable[Any]],
    label: str = "background task",
) -> asyncio.Task:
    """Spawn a fire-and-forget coroutine that logs failures instead of
    letting them vanish into the void (or crash the loop)."""
    task = asyncio.create_task(coro_factory())

    def _on_done(fut: asyncio.Future) -> None:
        if fut.cancelled():
            return
        exc = fut.exception()
        if exc is not None:
            logger.error("%s failed: %s", label, exc, exc_info=exc)

    task.add_done_callback(_on_done)
    return task