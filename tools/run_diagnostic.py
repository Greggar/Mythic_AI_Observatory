#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import sys
import time

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from services.probe_manager import save_probe_result, list_profiles

PROBES_PATH = os.path.join(os.path.dirname(__file__), "..", "backend", "data", "diagnostic_probes.json")
API_BASE = os.environ.get("CONDUCTOR_HOST", "http://127.0.0.1:8001")


def load_probes() -> list[dict]:
    if not os.path.exists(PROBES_PATH):
        print(f"Probes file not found: {PROBES_PATH}")
        sys.exit(1)
    with open(PROBES_PATH) as f:
        return json.load(f)


def list_probes(probes: list[dict]) -> None:
    print(f"{'ID':<22} {'Category':<14} Description")
    print("-" * 80)
    for p in probes:
        print(f"{p['id']:<22} {p['category']:<14} {p['description'][:70]}")


def print_profiles() -> None:
    profiles = list_profiles()
    if not profiles:
        print("No model profiles found.")
        return
    print(f"{'Model':<30} {'Provider':<14} {'Probes':<8} {'Completed':<12} Updated")
    print("-" * 90)
    for p in profiles:
        s = p.get("summary", {})
        print(f"{p['model'][:28]:<30} {p['provider'][:12]:<14} {s.get('total_probes',0):<8} {s.get('completed',0):<12} {p['updated_at'][:19]}")


async def submit_probe(client: httpx.AsyncClient, probe: dict) -> dict:
    print(f"  Submitting: {probe['id']} ... ", end="", flush=True)
    t0 = time.time()
    resp = await client.post(f"{API_BASE}/api/orchestrate", json={"prompt": probe["prompt"]})
    resp.raise_for_status()
    data = resp.json()
    trace_id = data["trace_id"]
    print(f"trace_id={trace_id}", flush=True)

    full_response = None
    model_used = None
    steps_count = 0
    error = None

    for _ in range(120):
        await asyncio.sleep(2)
        tr = await client.get(f"{API_BASE}/api/traces/{trace_id}")
        if tr.status_code != 200:
            continue
        trace = tr.json()
        full_response = trace.get("output") or full_response
        model_used = trace.get("model_used") or model_used
        steps_count = len(trace.get("steps", [])) or steps_count
        if trace.get("error"):
            error = trace["error"]
        if full_response:
            break
    else:
        error = "timeout"

    elapsed = round(time.time() - t0, 1)
    full_response = full_response or ""
    response_summary = full_response[:300] if full_response else ""

    save_probe_result(
        model_name=model_used or "unknown",
        provider="",
        probe_id=probe["id"],
        category=probe["category"],
        prompt=probe["prompt"],
        description=probe["description"],
        trace_id=trace_id,
        response=full_response,
        response_summary=response_summary,
        duration_seconds=elapsed,
        steps_count=steps_count,
        error=error,
    )

    return {
        "id": probe["id"],
        "category": probe["category"],
        "trace_id": trace_id,
        "output": full_response[:300],
        "error": error,
        "model": model_used or "unknown",
        "steps": steps_count,
        "duration": elapsed,
    }


async def main():
    parser = argparse.ArgumentParser(description="Run diagnostic probes against the Observatory")
    parser.add_argument("--list", action="store_true", help="List available probes")
    parser.add_argument("--profiles", action="store_true", help="List saved model profiles")
    parser.add_argument("--category", help="Run only probes in this category")
    parser.add_argument("--id", help="Run a single probe by ID")
    parser.add_argument("--concurrency", type=int, default=3, help="Max concurrent probes (default 3)")
    args = parser.parse_args()

    if args.profiles:
        print_profiles()
        return

    probes = load_probes()

    if args.list:
        list_probes(probes)
        return

    if args.id:
        probes = [p for p in probes if p["id"] == args.id]
    elif args.category:
        probes = [p for p in probes if p["category"] == args.category]

    if not probes:
        print("No probes matched.")
        return

    print(f"Submitting {len(probes)} diagnostic probe(s) to {API_BASE} ...\n")

    sem = asyncio.Semaphore(args.concurrency)
    results: list[dict] = []

    async with httpx.AsyncClient(timeout=300.0) as client:
        jobs = []
        for probe in probes:
            async def run(p=probe):
                async with sem:
                    return await submit_probe(client, p)
            jobs.append(run())
        results = await asyncio.gather(*jobs)

    print("\n── Results ──")
    for r in results:
        status = "✓" if r.get("output") and not r.get("error") else "✗"
        err = f" error={r['error']}" if r.get("error") else ""
        print(f"  {status} {r['id']:<22} model={r.get('model','?'):<20} steps={r.get('steps','?'):<2} dur={r.get('duration',0):.0f}s{err}")
        if r.get("output"):
            print(f"      {r['output'][:120]}")

    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
