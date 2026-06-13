#!/usr/bin/env python3
"""One-time backfill: classify all existing traces with LCC metadata."""

import asyncio
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from models.trace import TraceSession
from services.lcc_embeddings import classify_lcc

HISTORY_FILE = os.path.join(
    os.path.dirname(__file__), "..", "backend", "data", "traces.jsonl"
)

CONCURRENCY = 8


async def _classify_one(
    data: dict, line_idx: int
) -> tuple[int, bool, bool]:
    try:
        if data.get("lcc") and data["lcc"].get("prompt"):
            return line_idx, False, False

        trace = TraceSession(**data)
        lcc = await classify_lcc(trace.prompt, trace.output)

        if lcc.prompt or lcc.response:
            data["lcc"] = json.loads(lcc.model_dump_json())
            return line_idx, True, False
        return line_idx, False, True
    except Exception as e:
        print(f"  Error at line {line_idx}: {e}")
        return line_idx, False, True


async def main() -> None:
    if not os.path.exists(HISTORY_FILE):
        print(f"No trace history found at {HISTORY_FILE}")
        return

    with open(HISTORY_FILE) as f:
        lines = f.readlines()

    updated = 0
    skipped = 0
    errors = 0
    total = len(lines)
    pending: list[int] = []

    for i, raw in enumerate(lines):
        raw = raw.strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            errors += 1
            continue
        if data.get("lcc") and data["lcc"].get("prompt"):
            skipped += 1
            continue
        pending.append(i)

    print(f"{total} total, {skipped} already have LCC, {len(pending)} to classify")
    t0 = time.time()

    sem = asyncio.Semaphore(CONCURRENCY)

    async def worker(idx: int) -> None:
        nonlocal updated, errors, lines
        data = json.loads(lines[idx].strip())
        prompt_preview = data.get("prompt", "?")[:60].replace("\n", " ")
        async with sem:
            line_idx, was_updated, was_error = await _classify_one(data, idx)
        if was_updated:
            lines[line_idx] = json.dumps(data) + "\n"
            updated += 1
            p = (data.get("lcc") or {}).get("prompt")
            if p:
                print(f"  [{line_idx+1}/{total}] {data.get('id','?')}: {p.get('code','?')} {p.get('label','?')} | {prompt_preview}")
            else:
                print(f"  [{line_idx+1}/{total}] {data.get('id','?')}: (response only) | {prompt_preview}")
        elif was_error:
            errors += 1
            print(f"  [{line_idx+1}/{total}] FAIL {data.get('id','?')}: {prompt_preview}")
        else:
            skipped += 1

    await asyncio.gather(*[worker(idx) for idx in pending])

    with open(HISTORY_FILE, "w") as f:
        f.writelines(lines)

    elapsed = time.time() - t0
    print(f"\nDone: {updated} updated, {skipped} skipped, {errors} errors ({elapsed:.1f}s)")


if __name__ == "__main__":
    asyncio.run(main())
