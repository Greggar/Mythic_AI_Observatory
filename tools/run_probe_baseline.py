#!/usr/bin/env python3
"""Weekly probe baseline — run both probe batteries and accumulate history.

Starts the reasoning (GSM-Symbolic fragility) and complexity (efficiency ratio)
probe batteries against the conductor API, polls them to completion, and appends
each aggregate summary plus run metadata to ``backend/data/probe_history.jsonl``.
Repeated runs turn one-shot fragility/efficiency readings into a comparable
longitudinal series per model.

The active execution model is read from ``data/network.json`` unless overridden.
The seed defaults to a fixed constant so each week exercises the *same* problems —
differences across runs then reflect model drift, not problem difficulty.

Usage (run from the repo root with the conductor venv):

  backend/.venv/bin/python tools/run_probe_baseline.py
  backend/.venv/bin/python tools/run_probe_baseline.py --model qwen2.5:3b --provider local
  backend/.venv/bin/python tools/run_probe_baseline.py --reasoning-templates fruit --complexity-generators arithmetic_chain

Exit code 0 on full success; non-zero on any failure (for the systemd timer to log).
"""

import argparse
import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import requests

DEFAULT_SEED = 42
DEFAULT_POLL_S = 30
DEFAULT_TIMEOUT_S = 2700  # 45 min — full complexity battery can take a while

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
HISTORY_FILE = BACKEND_DIR / "data" / "probe_history.jsonl"
NETWORK_CONFIG = BACKEND_DIR / "data" / "network.json"


def _log(msg: str) -> None:
    print(msg, flush=True)


def load_active_model() -> tuple[str, str]:
    """Return (provider, model) from network.json; fall back to local/qwen2.5:3b."""
    try:
        cfg = json.loads(NETWORK_CONFIG.read_text())
        provider = cfg.get("model_provider") or {}
        return str(provider.get("provider") or "local"), str(provider.get("model") or "qwen2.5:3b")
    except FileNotFoundError:
        return "local", "qwen2.5:3b"


def start_probe(base_url: str, probe: str, model_cfg: dict[str, str], extra: dict) -> str:
    resp = requests.post(f"{base_url}/api/probe/{probe}", json={"models": [model_cfg], **extra}, timeout=15)
    resp.raise_for_status()
    return resp.json()["run_id"]


def wait_done(base_url: str, probe: str, run_id: str, timeout_s: int, poll_s: int) -> dict:
    started = time.monotonic()
    while time.monotonic() - started < timeout_s:
        resp = requests.get(f"{base_url}/api/probe/{probe}/{run_id}", timeout=15)
        if resp.status_code == 404:
            raise RuntimeError(f"probe run {run_id} vanished — conductor restarted mid-run")
        resp.raise_for_status()
        state = resp.json()
        if state.get("status") == "done":
            return state
        time.sleep(poll_s)
    raise TimeoutError(f"probe run {run_id} did not finish within {timeout_s}s")


def fetch_summary(base_url: str, probe: str, run_id: str) -> dict:
    resp = requests.get(f"{base_url}/api/probe/{probe}/{run_id}/summary", timeout=15)
    resp.raise_for_status()
    return resp.json()


def append_record(probe: str, model_cfg: dict[str, str], run: dict, summary: dict) -> None:
    record = {
        "type": probe,
        "run_at": datetime.now(UTC).isoformat(),
        "model": model_cfg["model"],
        "provider": model_cfg["provider"],
        "seed": run.get("seed"),
        "run_id": run["run_id"],
        "total": run.get("total", 0),
        "completed": run.get("completed", 0),
        "failed": run.get("failed", 0),
        "summary": summary,
    }
    with HISTORY_FILE.open("a") as fh:
        fh.write(json.dumps(record) + "\n")
    _log(f"  appended {probe} record ({run.get('completed')}/{run.get('total')} cells, failed={run.get('failed')})")


def run_battery(base_url: str, probe: str, model_cfg: dict[str, str], extra: dict,
                timeout_s: int, poll_s: int) -> dict:
    _log(f"[{probe}] starting…")
    run_id = start_probe(base_url, probe, model_cfg, extra)
    _log(f"[{probe}] run {run_id}")
    run = wait_done(base_url, probe, run_id, timeout_s, poll_s)
    summary = fetch_summary(base_url, probe, run_id)
    append_record(probe, model_cfg, run, summary)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--model", help="model name (default: active model from network.json)")
    parser.add_argument("--provider", choices=["local", "worker"], help="node provider (default: from network.json)")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="RNG seed for problem re-rolls (default: 42 — fixed for comparability)")
    parser.add_argument("--base-url", default=os.environ.get("CONDUCTOR_URL", "http://127.0.0.1:8001"), help="conductor base URL")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_S, help="per-battery timeout in seconds")
    parser.add_argument("--poll", type=int, default=DEFAULT_POLL_S, help="status poll interval in seconds")
    parser.add_argument("--reasoning-templates", nargs="*", help="limit reasoning templates (ids: clips fruit train pencils baker)")
    parser.add_argument("--complexity-generators", nargs="*", help="limit complexity generators (arithmetic_chain tower_of_hanoi)")
    parser.add_argument("--skip-reasoning", action="store_true", help="skip the reasoning battery")
    parser.add_argument("--skip-complexity", action="store_true", help="skip the complexity battery")
    args = parser.parse_args()

    provider = args.provider
    model = args.model
    if provider is None or model is None:
        default_provider, default_model = load_active_model()
        provider = provider or default_provider
        model = model or default_model
    model_cfg = {"provider": provider, "model": model}

    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)

    _log(f"probe baseline → model={model} provider={provider} seed={args.seed}")
    if not args.skip_reasoning and not args.skip_complexity:
        _log("Running full battery — this can take 15–25 minutes on GPU.")

    failures: list[str] = []
    if not args.skip_reasoning:
        try:
            run_battery(
                args.base_url, "reasoning", model_cfg,
                {"template_ids": args.reasoning_templates or None, "seed": args.seed},
                args.timeout, args.poll,
            )
        except Exception as exc:
            failures.append(f"reasoning: {exc}")
    if not args.skip_complexity:
        try:
            run_battery(
                args.base_url, "complexity", model_cfg,
                {"generators": args.complexity_generators or None, "seed": args.seed},
                args.timeout, args.poll,
            )
        except Exception as exc:
            failures.append(f"complexity: {exc}")

    if failures:
        for item in failures:
            _log(f"FAILED: {item}")
        return 1
    _log("probe baseline complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())