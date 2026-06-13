#!/usr/bin/env python3
"""Backfill: add multi-label alternatives to existing traces."""

import asyncio
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from services.ddc_embeddings import classify_multi as classify_multi_ddc
from services.lcc_embeddings import classify_multi as classify_multi_lcc

HISTORY_FILE = os.path.join(
    os.path.dirname(__file__), "..", "backend", "data", "traces.jsonl"
)

CONCURRENCY = 8


async def main() -> None:
    if not os.path.exists(HISTORY_FILE):
        print("No trace history found")
        return

    with open(HISTORY_FILE) as f:
        lines = f.readlines()

    updated = 0
    skipped = 0
    errors = 0
    total = len(lines)

    sem = asyncio.Semaphore(CONCURRENCY)

    async def worker(idx: int) -> None:
        nonlocal updated, skipped, errors, lines
        raw = lines[idx].strip()
        if not raw:
            return
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            errors += 1
            return

        prompt = data.get("prompt", "")
        changed = False

        # DDC alternatives
        ddc = data.get("ddc")
        if ddc and ddc.get("prompt") and ddc["prompt"].get("code"):
            if not ddc.get("prompt_alternatives"):
                alts = await classify_multi_ddc(prompt, top_n=3)
                ddc["prompt_alternatives"] = [
                    a.model_dump() for a in alts if a.code != ddc["prompt"]["code"]
                ][:2]
                changed = True

        # LCC alternatives
        lcc = data.get("lcc")
        if lcc and lcc.get("prompt") and lcc["prompt"].get("code"):
            if not lcc.get("prompt_alternatives"):
                alts = await classify_multi_lcc(prompt, top_n=3)
                lcc["prompt_alternatives"] = [
                    a.model_dump() for a in alts if a.code != lcc["prompt"]["code"]
                ][:2]
                changed = True

        if changed:
            lines[idx] = json.dumps(data) + "\n"
            updated += 1
            pid = data.get("id", "?")[:8]
            prompt_preview = prompt[:50].replace("\n", " ")
            ddc_alts = len(ddc.get("prompt_alternatives", [])) if ddc else 0
            lcc_alts = len(lcc.get("prompt_alternatives", [])) if lcc else 0
            print(f"  [{idx+1}/{total}] {pid}: +{ddc_alts} DDC +{lcc_alts} LCC alts | {prompt_preview}")
        else:
            skipped += 1

    print(f"{total} total traces")
    t0 = time.time()
    await asyncio.gather(*[worker(idx) for idx in range(total)])
    elapsed = time.time() - t0

    with open(HISTORY_FILE, "w") as f:
        f.writelines(lines)

    print(f"\nDone: {updated} updated, {skipped} skipped, {errors} errors ({elapsed:.1f}s)")


if __name__ == "__main__":
    asyncio.run(main())
