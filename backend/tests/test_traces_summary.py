"""Summary-view tests — /api/traces?view=summary strips heavy payloads.

The list endpoint is the hottest polling surface (Systems/History/Analysis tabs
re-fetch it every few seconds). The summary view keeps everything the
constellation/galaxy/history/status panels read (DDC/LCC, synesth, token-entropy
aggregates, step durations, output) while dropping the per-token / per-step bulk
that only detail views use: embeddings, entropy & branching series, retrieved
chunks, vector graph, context assemblies, rationales, LLM insights.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from models.trace import TokenEntropy, TraceSession, TraceStep
from services.orchestrator import summarize_trace


def _make_trace() -> TraceSession:
    return TraceSession(
        id="t1",
        prompt="p",
        output="o",
        embedding=[0.1] * 384,
        response_rationale="why",
        trace_explanation="exp",
        llm_insights=[{"type": "info", "title": "x", "body": "b"}],
        token_entropy=TokenEntropy(
            mean_entropy=0.5,
            p95_entropy=1.0,
            mean_surprisal=0.4,
            high_entropy_count=3,
            token_count=10,
            top_k=5,
            series=[0.1] * 40,
            branching_series=[1.07] * 40,
        ),
        steps=[
            TraceStep(
                id="s1",
                label="Memory Retrieval",
                status="complete",
                duration_ms=123,
                metadata={
                    "retrieved_chunks": [{"content": "c"}],
                    "vector_graph": {"points": []},
                    "output": "big",
                    "intent_probs": [{"label": "x", "confidence": 0.9, "reasoning": "r"}],
                },
                context_assembled="ctx",
            )
        ],
    )


def test_summary_drops_heavy_fields():
    t = summarize_trace(_make_trace())
    assert t.embedding is None
    assert t.response_rationale is None
    assert t.trace_explanation is None
    assert t.llm_insights == []
    assert t.token_entropy is not None
    assert t.token_entropy.series == []
    assert t.token_entropy.branching_series == []
    assert t.steps[0].metadata == {}
    assert t.steps[0].context_assembled is None


def test_summary_keeps_light_fields():
    t = summarize_trace(_make_trace())
    assert t.output == "o"
    assert t.prompt == "p"
    assert t.steps[0].duration_ms == 123
    assert t.steps[0].label == "Memory Retrieval"
    assert t.token_entropy is not None
    assert t.token_entropy.mean_entropy == 0.5
    assert t.token_entropy.high_entropy_count == 3


def test_full_copy_is_unchanged():
    src = _make_trace()
    t = summarize_trace(src)
    assert t.id == "t1"
    assert src.embedding is not None  # original object untouched
    assert src.steps[0].metadata  # original metadata intact
