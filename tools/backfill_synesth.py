#!/usr/bin/env python3
"""Backfill synesthesia classifications using backoffice GPU.

Reads all existing traces from traces.jsonl, classifies each via the
backoffice LLM, and writes results to synesth_cache.json.

Usage:
    python tools/backfill_synesth.py              # backoffice GPU
    python tools/backfill_synesth.py --local       # local qwen2.5:1.5b
"""

import argparse
import asyncio
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from services.classifier_agent import classify_trace_to_cache, load_schema
from services import config_manager

HISTORY_FILE = os.path.join(
    os.path.dirname(__file__), "..", "backend", "data", "traces.jsonl"
)

CONCURRENCY = 1


async def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill synesthesia classifications")
    parser.add_argument("--local", action="store_true", help="Use local model instead of backoffice GPU")
    args = parser.parse_args()

    schema = load_schema()
    if not schema:
        print("ERROR: No schema found at backend/services/synesthesia_schema.md")
        sys.exit(1)
    print(f"Schema loaded ({len(schema)} chars)")

    if args.local:
        base_url = config_manager.get_ollama_url()
        model_name = "qwen2.5:1.5b"
        print(f"Using LOCAL: {base_url} / {model_name}")
    else:
        base_url = config_manager.get_backoffice_url()
        model_name = config_manager.get_backoffice_model()
        print(f"Using BACKOFFICE: {base_url} / {model_name}")

    if not base_url:
        print("ERROR: No URL configured for the selected provider")
        sys.exit(1)

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
            ok = await classify_trace_to_cache(t, schema, base_url=base_url, model_name=model_name)
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
