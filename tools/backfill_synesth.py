#!/usr/bin/env python3
"""Backfill synesthesia classifications using embedding similarity.

Reads all existing traces from traces.jsonl, classifies each via the
embedding-based synesth classifier (all-minilm), and writes results to
synesth_cache.json.

Usage:
    python tools/backfill_synesth.py
"""

import asyncio
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from services.classifier_agent import classify_trace_to_cache

HISTORY_FILE = os.path.join(
    os.path.dirname(__file__), "..", "backend", "data", "traces.jsonl"
)

CONCURRENCY = 5


async def main() -> None:
    if not os.path.exists(HISTORY_FILE):
        print("No trace history found")
        return

    with open(HISTORY_FILE) as f:
        lines = f.readlines()

    from models.trace import TraceSession
    traces: list[TraceSession] = []
    for raw in lines:
        raw = raw.strip()
        if raw:
            try:
                traces.append(TraceSession.model_validate_json(raw))
            except Exception:
                continue

    print(f"Loaded {len(traces)} traces from history")

    from services.classifier_agent import _load_cache
    cache = _load_cache()
    pending = [t for t in traces if t.id not in cache and t.output is not None]
    print(f"{len(pending)} need classification ({len(traces) - len(pending)} already cached)")

    if not pending:
        print("Nothing to do")
        return

    sem = asyncio.Semaphore(CONCURRENCY)

    async def worker(t: TraceSession) -> None:
        async with sem:
            ok = await classify_trace_to_cache(t)
            if ok:
                print(f"  ✓ {t.id[:12]} {t.prompt[:50]}")
            else:
                print(f"  ✗ {t.id[:12]} FAILED")

    start = time.time()
    await asyncio.gather(*[worker(t) for t in pending])
    elapsed = time.time() - start

    cache = _load_cache()
    classified = sum(1 for t in traces if t.id in cache)
    print(f"\nDone: {classified}/{len(traces)} classified in {elapsed:.1f}s")


if __name__ == "__main__":
    asyncio.run(main())
