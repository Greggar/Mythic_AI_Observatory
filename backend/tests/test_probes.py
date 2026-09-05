"""Probe machinery tests — shared base + per-module run orchestration.

Covers the answer-extraction heuristics, the background run launcher
(concurrency, tally, status transition), and offline end-to-end runs of the
reasoning and complexity probes with ``_call_model`` / ``classify_ddc`` stubbed
so no network or model is required.
"""

import asyncio

from services import complexity_probe, reasoning_probe
from services.probe_base import (
    ProbeCell,
    ProbeRunStatus,
    extract_answer,
    launch_probe_run,
    mentions_exact,
)

# ── Answer-extraction heuristics ────────────────────────────────────

def test_extract_answer_keyword_line():
    assert extract_answer("Working:\nTotal: 72\n") == 72.0
    assert extract_answer("The final answer is 7") == 7.0
    assert extract_answer("result = 3.5") == 3.5


def test_extract_answer_minimum_keyword():
    assert extract_answer("The minimum number of moves is 31") == 31.0


def test_extract_answer_skips_list_markers():
    # "200" is the last real number; the "2." line marker is skipped.
    assert extract_answer("Working:\n1. 100\n2. 200") == 200.0


def test_extract_answer_none_without_numbers():
    assert extract_answer("I can't compute this.") is None
    assert extract_answer("") is None


def test_mentions_exact_standalone_number():
    assert mentions_exact("The answer is 72", 72.0) is True
    assert mentions_exact("The answer is 720", 72.0) is False
    assert mentions_exact("The answer is 7", 72.0) is False


# ── Run launcher (probe_base.launch_probe_run) ─────────────────────

def _make_cells(n: int) -> list[ProbeCell]:
    return [ProbeCell(cell_id=f"c{i}", model="m", provider="p") for i in range(n)]


def test_launch_probe_run_tallies_and_flips_status():
    async def main():
        store = {}
        run = ProbeRunStatus(run_id="r1", started_at="x", seed=1, cells=_make_cells(3))

        async def runner(cell):
            cell.status = "complete"
            cell.correct = True

        launch_probe_run(store, run, runner)
        for _ in range(400):
            if run.status == "done":
                break
            await asyncio.sleep(0.005)
        assert run.status == "done"
        assert run.completed == 3
        assert run.failed == 0
        assert store["r1"] is run

    asyncio.run(main())


def test_launch_probe_run_counts_errors():
    async def main():
        store = {}
        run = ProbeRunStatus(run_id="r2", started_at="x", seed=1, cells=_make_cells(4))

        async def runner(cell):
            if cell.cell_id in ("c0", "c2"):
                cell.status = "error"
                cell.error = "boom"
            else:
                cell.status = "complete"

        launch_probe_run(store, run, runner)
        for _ in range(400):
            if run.status == "done":
                break
            await asyncio.sleep(0.005)
        assert run.status == "done"
        assert run.completed == 2
        assert run.failed == 2

    asyncio.run(main())


def test_launch_probe_run_respects_concurrency():
    async def main():
        store = {}
        run = ProbeRunStatus(run_id="r3", started_at="x", seed=1, cells=_make_cells(6))
        active = 0
        peak = 0

        async def runner(cell):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.02)
            active -= 1
            cell.status = "complete"

        launch_probe_run(store, run, runner, concurrency=2)
        for _ in range(400):
            if run.status == "done":
                break
            await asyncio.sleep(0.005)
        assert run.status == "done"
        assert run.completed == 6
        assert peak <= 2

    asyncio.run(main())


# ── Offline end-to-end runs (network stubbed) ──────────────────────

async def _stub_call(model, prompt, system=None, model_name_override=None, provider_override=None):
    return "Working:\nTotal: 72\n\n72", 18, 0.42, {
        "mean_entropy": 0.35,
        "p95_entropy": 0.9,
        "median_branching": 1.27,
    }


def test_reasoning_probe_end_to_end(monkeypatch):
    async def _ddc(text, model=None):
        class _Entry:
            top_scores = [{"score": 0.5}, {"score": 0.3}]

        class _Meta:
            prompt = _Entry()

        return _Meta()

    monkeypatch.setattr(reasoning_probe, "_call_model", _stub_call)
    monkeypatch.setattr(reasoning_probe, "classify_ddc", _ddc)

    async def main():
        run = reasoning_probe.start_reasoning_probe(
            [{"model": "m1", "provider": "local"}], template_ids=["clips"], seed=7,
        )
        assert run.total == 3  # 1 template x 1 model x 3 variants
        for _ in range(600):
            stored = reasoning_probe.get_reasoning_probe(run.run_id)
            if stored.status == "done":
                break
            await asyncio.sleep(0.005)
        assert stored.status == "done"
        assert stored.completed + stored.failed == stored.total
        assert {c.variant for c in stored.cells} == {"base", "symbolic", "noop"}
        for c in stored.cells:
            assert c.entropy_mean == 0.35
            assert c.median_branching == 1.27
            assert c.ddc_margin == 0.2
        agg = reasoning_probe.aggregate_reasoning_probe(run.run_id)
        assert agg["status"] == "done"
        assert len(agg["rows"]) == 1
        assert agg["rows"][0]["base"]["n"] == 1
        assert "narrative" in agg

    asyncio.run(main())


def test_complexity_probe_end_to_end(monkeypatch):
    monkeypatch.setattr(complexity_probe, "_call_model", _stub_call)

    async def main():
        run = complexity_probe.start_complexity_probe(
            [{"model": "m2", "provider": "worker"}], generators=["arithmetic_chain"], seed=3,
        )
        # ranges 2..10 = 9 levels x 5 instances x 1 model
        assert run.total == 45
        for _ in range(600):
            stored = complexity_probe.get_complexity_probe(run.run_id)
            if stored.status == "done":
                break
            await asyncio.sleep(0.005)
        assert stored.status == "done"
        assert stored.completed + stored.failed == stored.total
        assert stored.generators == ["arithmetic_chain"]
        assert all(c.complexity >= 2 for c in stored.cells)
        agg = complexity_probe.aggregate_complexity_probe(run.run_id)
        levels = agg["generators"]["arithmetic_chain"]
        assert len(levels) == 9
        assert levels[0]["models"]["m2"]["mean_tokens"] == 18.0
        assert "narrative" in agg

    asyncio.run(main())


def test_probe_unknown_runs_return_sentinel():
    assert reasoning_probe.get_reasoning_probe("nope") is None
    assert reasoning_probe.aggregate_reasoning_probe("nope") == {}
    assert complexity_probe.get_complexity_probe("nope") is None
    assert complexity_probe.aggregate_complexity_probe("nope") == {}